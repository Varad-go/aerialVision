/*
 * WasteScan – detection.js
 * -----------------------------------------------------------------------------
 * The heuristic image-analysis pipeline. DOM-free so it can run inside a Web
 * Worker (and in Node for the automated tests in /tests).
 *
 * Pipeline (one "step" each, so progress can be reported):
 *   1. Pre-processing      – luminance, HSV colour buckets, global image statistics
 *   2. Texture features    – Sobel gradients, local luminance std-dev, edge density,
 *                            4-fold orientation coherence (regular vs. irregular edges)
 *   3. Colour features     – local RGB colour variation, local-vs-surrounding contrast
 *   4. Colour diversity    – local histogram of 8 colour buckets (entropy, bright+dark mix,
 *                            share of "synthetic" saturated colours)
 *   5. Land-cover classes  – rule-based classifier + modal smoothing
 *   6. Waste scoring       – weighted combination of the cues above, with context gates
 *   7. Region grouping     – threshold, morphological open/close, 8-connected labelling,
 *                            minimum-size filter, region statistics
 *   8. Statistics          – final label map, pixel counts, warnings, input suitability
 *
 * RESULTS ARE HEURISTIC ESTIMATES. Nothing here is a trained model.
 */
(function (root) {
  'use strict';

  function factory(WS) {
    var C = WS.Classifier;
    var CLASS = C.CLASS;

    var RESOLUTIONS = { low: 480, medium: 800, high: 1200 };

    var DEFAULT_SETTINGS = {
      sensitivity: 50,        // 0-100  – higher = lower score threshold = more candidates
      colourVariation: 22,    // 5-80   – minimum local RGB std-dev required for a candidate
      minRegionPct: 0.15,     // % of the image – smaller candidate regions are discarded
      resolution: 'medium',   // low | medium | high  (long side 480 / 800 / 1200 px)
      gsd: 0,                 // optional ground sampling distance, metres per ORIGINAL pixel (0 = unknown)
      colourCorrection: false // optional grey-world colour-cast correction + contrast stretch
    };

    /** Weights of the individual cues in the waste-likelihood score (sum = 1). */
    var WEIGHTS = { cv: 0.20, tex: 0.11, div: 0.18, bd: 0.13, irr: 0.15, con: 0.15, syn: 0.08 };

    /** Candidates more elongated than this (major/minor axis) are treated as linear features, not dumps. */
    var MAX_ELONGATION = 3.5;
    /** Candidates thinner than this many window radii are outlines / lines, not dump sites. */
    var MIN_THICKNESS_FACTOR = 2.8;

    function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
    function clampN(x, a, b) { return x < a ? a : (x > b ? b : x); }

    /** Score threshold as a function of the sensitivity slider (0-100). */
    function thresholdFor(sensitivity) {
      return 0.70 - 0.45 * (clampN(sensitivity, 0, 100) / 100);
    }

    /**
     * Separable box-filter mean with clamped borders.
     * out may be the same array as src. `tmp` must be a separate Float32Array(w*h).
     */
    function boxMean(src, w, h, r, out, tmp) {
      var pre = new Float64Array(w + 1);
      var y, x, o, lo, hi;
      for (y = 0; y < h; y++) {
        o = y * w;
        pre[0] = 0;
        for (x = 0; x < w; x++) pre[x + 1] = pre[x] + src[o + x];
        for (x = 0; x < w; x++) {
          lo = x - r < 0 ? 0 : x - r;
          hi = x + r >= w ? w - 1 : x + r;
          tmp[o + x] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1);
        }
      }
      var col = new Float64Array(w);
      var top = r < h - 1 ? r : h - 1;
      for (y = 0; y <= top; y++) {
        o = y * w;
        for (x = 0; x < w; x++) col[x] += tmp[o + x];
      }
      var cnt;
      for (y = 0; y < h; y++) {
        lo = y - r < 0 ? 0 : y - r;
        hi = y + r >= h ? h - 1 : y + r;
        cnt = hi - lo + 1;
        o = y * w;
        for (x = 0; x < w; x++) out[o + x] = col[x] / cnt;
        var add = y + r + 1, rem = y - r;
        if (add < h) { var oa = add * w; for (x = 0; x < w; x++) col[x] += tmp[oa + x]; }
        if (rem >= 0) { var orr = rem * w; for (x = 0; x < w; x++) col[x] -= tmp[orr + x]; }
      }
      return out;
    }

    /** Binary morphology with a square structuring element, implemented through box means. */
    function morph(mask, w, h, rad, grow, ctx) {
      var n = w * h, i;
      var f = ctx.f1;
      for (i = 0; i < n; i++) f[i] = mask[i];
      boxMean(f, w, h, rad, f, ctx.tmp);
      var out = new Uint8Array(n);
      if (grow) { for (i = 0; i < n; i++) out[i] = f[i] > 0.0001 ? 1 : 0; }
      else { for (i = 0; i < n; i++) out[i] = f[i] > 0.9999 ? 1 : 0; }
      return out;
    }

    /**
     * Finds the photographic content area: rows/columns at the image edges that are flat white/grey/black or
     * almost entirely black (page margins, scan borders, frames) are excluded from the analysis.
     */
    function findContentBox(luma, w, h) {
      function rowMargin(y) {
        var s = 0, s2 = 0, dk = 0, br = 0, o = y * w, v;
        for (var x = 0; x < w; x++) { v = luma[o + x]; s += v; s2 += v * v; if (v < 30) dk++; else if (v > 238) br++; }
        var mean = s / w, std = Math.sqrt(Math.max(0, s2 / w - mean * mean));
        return dk / w > 0.85 || br / w > 0.9 || (std < 3 && (mean > 175 || mean < 45));
      }
      function colMargin(x, y0, y1) {
        var s = 0, s2 = 0, dk = 0, br = 0, c = y1 - y0 + 1, v;
        for (var y = y0; y <= y1; y++) { v = luma[y * w + x]; s += v; s2 += v * v; if (v < 30) dk++; else if (v > 238) br++; }
        var mean = s / c, std = Math.sqrt(Math.max(0, s2 / c - mean * mean));
        return dk / c > 0.85 || br / c > 0.9 || (std < 3 && (mean > 175 || mean < 45));
      }
      var maxY = Math.floor(h * 0.3), maxX = Math.floor(w * 0.3);
      var y0 = 0, y1 = h - 1, x0 = 0, x1 = w - 1;
      while (y0 < maxY && rowMargin(y0)) y0++;
      while (h - 1 - y1 < maxY && y1 > y0 && rowMargin(y1)) y1--;
      while (x0 < maxX && colMargin(x0, y0, y1)) x0++;
      while (w - 1 - x1 < maxX && x1 > x0 && colMargin(x1, y0, y1)) x1--;
      if ((x1 - x0 + 1) * (y1 - y0 + 1) < w * h * 0.25) return { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
      return { x0: x0, y0: y0, x1: x1, y1: y1 };
    }

    /** Build an analysis job. `rgba` is a Uint8ClampedArray of size w*h*4. */
    function createJob(rgba, w, h, userSettings) {
      var s = {};
      var k;
      for (k in DEFAULT_SETTINGS) s[k] = DEFAULT_SETTINGS[k];
      if (userSettings) for (k in userSettings) if (userSettings[k] !== undefined && userSettings[k] !== null) s[k] = userSettings[k];

      var n = w * h;
      var longSide = Math.max(w, h);
      var r = clampN(Math.round(longSide / 200), 2, 7);   // base window radius (window = 2r+1)
      var ctx = {
        w: w, h: h, n: n, r: r, s: s, rgba: rgba,
        thr: thresholdFor(s.sensitivity),
        tmp: new Float32Array(n), f1: new Float32Array(n),
        stats: {}, timings: {}
      };
      var hsv = [0, 0, 0];

      var steps = [];

      // ---------------------------------------------------------------- 1. preprocessing
      steps.push({ label: 'Pre-processing: reading RGB values and borders', weight: 8, run: function () {
        var i, p, x, y;
        var luma = new Float32Array(n);
        for (i = 0, p = 0; i < n; i++, p += 4) luma[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];

        // content area: exclude flat / black borders and page margins
        var box = findContentBox(luma, w, h);
        var valid = new Uint8Array(n);
        for (y = box.y0; y <= box.y1; y++) for (x = box.x0; x <= box.x1; x++) valid[y * w + x] = 1;
        var nv = (box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1);
        if (nv < n) {
          // replicate the nearest content pixel into the excluded margin so that windowed features near the border stay clean
          for (y = 0; y < h; y++) {
            var sy = y < box.y0 ? box.y0 : (y > box.y1 ? box.y1 : y);
            for (x = 0; x < w; x++) {
              if (valid[y * w + x]) continue;
              var sx = x < box.x0 ? box.x0 : (x > box.x1 ? box.x1 : x);
              var q = (sy * w + sx) * 4; p = (y * w + x) * 4;
              rgba[p] = rgba[q]; rgba[p + 1] = rgba[q + 1]; rgba[p + 2] = rgba[q + 2];
              luma[y * w + x] = luma[sy * w + sx];
            }
          }
        }
        ctx.box = box; ctx.valid = valid; ctx.nv = nv;

        // optional colour-cast correction (grey-world gains) + robust contrast stretch
        if (s.colourCorrection) {
          var sr = 0, sg = 0, sb = 0;
          for (i = 0, p = 0; i < n; i++, p += 4) if (valid[i]) { sr += rgba[p]; sg += rgba[p + 1]; sb += rgba[p + 2]; }
          var mr = sr / nv, mg2 = sg / nv, mb = sb / nv, mm = (mr + mg2 + mb) / 3;
          var gr = clampN(mm / Math.max(1, mr), 0.6, 1.7), gg = clampN(mm / Math.max(1, mg2), 0.6, 1.7), gb = clampN(mm / Math.max(1, mb), 0.6, 1.7);
          var hist = new Uint32Array(256);
          for (i = 0, p = 0; i < n; i++, p += 4) if (valid[i]) hist[clampN(Math.round(0.299 * rgba[p] * gr + 0.587 * rgba[p + 1] * gg + 0.114 * rgba[p + 2] * gb), 0, 255)]++;
          var acc = 0, lo = 0, hi = 255, t1 = nv * 0.01, t99 = nv * 0.99;
          for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= t1) { lo = i; break; } }
          acc = 0; for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= t99) { hi = i; break; } }
          var scale = hi - lo > 20 ? Math.min(2.2, 255 / (hi - lo)) : 1, off = hi - lo > 20 ? lo : 0;
          // the corrected copy is used for LAND-COVER classification only; the waste cues keep the original colours
          var corr = new Uint8ClampedArray(n * 4);
          for (i = 0, p = 0; i < n; i++, p += 4) {
            corr[p] = clampN((rgba[p] * gr - off) * scale, 0, 255);
            corr[p + 1] = clampN((rgba[p + 1] * gg - off) * scale, 0, 255);
            corr[p + 2] = clampN((rgba[p + 2] * gb - off) * scale, 0, 255);
            corr[p + 3] = 255;
          }
          ctx.rgbCls = corr;
          ctx.stats.correction = { gains: [gr, gg, gb], lo: lo, hi: hi };
        }

        var bucket = new Uint8Array(n);
        var synth = new Float32Array(n);
        var sumL = 0, sumL2 = 0, sumS = 0, dark = 0, bright = 0, satCount = 0;
        var hueHist = new Uint32Array(36);
        for (i = 0, p = 0; i < n; i++, p += 4) {
          var R = rgba[p], G = rgba[p + 1], B = rgba[p + 2];
          C.rgbToHsv(R, G, B, hsv);
          bucket[i] = C.colourBucket(R, G, B, hsv);
          // "synthetic-looking" colour: strongly saturated blue->magenta (tarps, plastics, paint)
          synth[i] = (hsv[1] > 0.40 && hsv[2] > 0.25 && hsv[0] >= 190 && hsv[0] <= 335) ? 1 : 0;
          if (!valid[i]) continue;
          var l = luma[i];
          sumL += l; sumL2 += l * l; sumS += hsv[1];
          if (l < 12) dark++; else if (l > 245) bright++;
          if (hsv[1] > 0.12 && hsv[2] > 0.15) { satCount++; hueHist[Math.min(35, (hsv[0] / 10) | 0)]++; }
        }
        var mean = sumL / nv, conc = 0;
        for (i = 0; i < 36; i++) { var tri = hueHist[i] + hueHist[(i + 1) % 36] + hueHist[(i + 35) % 36]; if (tri > conc) conc = tri; }
        var flat = new Float32Array(n), dR, dG, dB;
        for (y = 0; y < h - 1; y++) {
          for (x = 0; x < w - 1; x++) {
            i = y * w + x; p = i * 4;
            dR = Math.abs(rgba[p] - rgba[p + 4]); dG = Math.abs(rgba[p + 1] - rgba[p + 5]); dB = Math.abs(rgba[p + 2] - rgba[p + 6]);
            if (dR > 2 || dG > 2 || dB > 2) continue;
            dR = Math.abs(rgba[p] - rgba[p + w * 4]); dG = Math.abs(rgba[p + 1] - rgba[p + w * 4 + 1]); dB = Math.abs(rgba[p + 2] - rgba[p + w * 4 + 2]);
            if (dR <= 2 && dG <= 2 && dB <= 2) flat[i] = 1;
          }
        }
        ctx.flat = flat;
        var fsum = 0; for (i = 0; i < n; i++) if (valid[i]) fsum += flat[i];
        ctx.stats.flatFraction = fsum / nv;
        ctx.luma = luma; ctx.bucket = bucket; ctx.synth = synth;
        ctx.stats.meanLuma = mean;
        ctx.stats.stdLuma = Math.sqrt(Math.max(0, sumL2 / nv - mean * mean));
        ctx.stats.meanSat = sumS / nv;
        ctx.stats.clipDark = dark / nv;
        ctx.stats.clipBright = bright / nv;
        ctx.stats.hueConcentration = satCount ? conc / satCount : 0;
        ctx.stats.satFraction = satCount / nv;
      }});

      // ---------------------------------------------------------------- 2. texture
      steps.push({ label: 'Texture analysis: gradients and local variation', weight: 17, run: function () {
        var luma = ctx.luma;
        var grad = new Float32Array(n), re = new Float32Array(n), im = new Float32Array(n), mg = new Float32Array(n);
        var x, y, i;
        var sumGrad = 0;
        for (y = 1; y < h - 1; y++) {
          for (x = 1; x < w - 1; x++) {
            i = y * w + x;
            var a = luma[i - w - 1], b = luma[i - w], c = luma[i - w + 1];
            var d = luma[i - 1], f = luma[i + 1];
            var g = luma[i + w - 1], hh = luma[i + w], j = luma[i + w + 1];
            var ix = ((c + 2 * f + j) - (a + 2 * d + g)) / 4;
            var iy = ((g + 2 * hh + j) - (a + 2 * b + c)) / 4;
            var m2 = ix * ix + iy * iy;
            grad[i] = Math.sqrt(m2);
            sumGrad += grad[i];
            // fourth power of the complex gradient (ix + i*iy)^4 → orientation coherence with 90° symmetry
            var A = ix * ix - iy * iy, B = 2 * ix * iy;
            re[i] = A * A - B * B;
            im[i] = 2 * A * B;
            mg[i] = m2 * m2;
          }
        }
        ctx.stats.meanGrad = sumGrad / ctx.nv;
        var t = ctx.tmp;
        var edge = new Float32Array(n);
        boxMean(grad, w, h, r, edge, t);
        ctx.edge = edge;

        // local luminance std-dev
        var m1 = new Float32Array(n), m2a = new Float32Array(n);
        boxMean(luma, w, h, r, m1, t);
        for (i = 0; i < n; i++) ctx.f1[i] = luma[i] * luma[i];
        boxMean(ctx.f1, w, h, r, m2a, t);
        var lumaStd = new Float32Array(n);
        for (i = 0; i < n; i++) lumaStd[i] = Math.sqrt(Math.max(0, m2a[i] - m1[i] * m1[i]));
        ctx.lumaStd = lumaStd;

        // fourfold orientation coherence – high for straight edges / building grids, low for chaotic debris
        boxMean(re, w, h, r, re, t);
        boxMean(im, w, h, r, im, t);
        boxMean(mg, w, h, r, mg, t);
        var coh = new Float32Array(n);
        for (i = 0; i < n; i++) coh[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / (mg[i] + 1e-6);
        ctx.coherence = coh;
      }});

      // ---------------------------------------------------------------- 3. colour
      steps.push({ label: 'Colour analysis: RGB variation and local contrast', weight: 17, run: function () {
        var cvar = new Float32Array(n), con = new Float32Array(n);
        var ch = new Float32Array(n), mS = new Float32Array(n), mL = new Float32Array(n), m2 = new Float32Array(n);
        var t = ctx.tmp, i;
        for (var c = 0; c < 3; c++) {
          for (i = 0; i < n; i++) ch[i] = rgba[i * 4 + c];
          boxMean(ch, w, h, r, mS, t);
          boxMean(ch, w, h, r * 3, mL, t);
          for (i = 0; i < n; i++) ch[i] = ch[i] * ch[i];
          boxMean(ch, w, h, r, m2, t);
          for (i = 0; i < n; i++) {
            var v = m2[i] - mS[i] * mS[i];
            cvar[i] += v > 0 ? v : 0;
            var d = mS[i] - mL[i];
            con[i] += d * d;
          }
        }
        for (i = 0; i < n; i++) { cvar[i] = Math.sqrt(cvar[i]); con[i] = Math.sqrt(con[i]); }
        ctx.colourVar = cvar; ctx.contrast = con;
      }});

      // ---------------------------------------------------------------- 4. diversity
      steps.push({ label: 'Colour diversity: bright / dark mixing', weight: 18, run: function () {
        var ent = new Float32Array(n), bd = new Float32Array(n), green = new Float32Array(n);
        var ind = new Float32Array(n), share = new Float32Array(n), neutral = new Float32Array(n), white = new Float32Array(n);
        var t = ctx.tmp, i, k;
        var dark = null;
        for (k = 0; k < 8; k++) {
          for (i = 0; i < n; i++) ind[i] = ctx.bucket[i] === k ? 1 : 0;
          boxMean(ind, w, h, r, share, t);
          for (i = 0; i < n; i++) { var p = share[i]; if (p > 1e-6) ent[i] -= p * Math.log(p); }
          if (k <= 2) { for (i = 0; i < n; i++) neutral[i] += share[i]; }
          if (k === 1) white.set(share);
          if (k === 0) { dark = new Float32Array(share); }
          else if (k === 1) { for (i = 0; i < n; i++) bd[i] = Math.min(dark[i], share[i]); }
          else if (k === 5) { green.set(share); }
        }
        var syn = new Float32Array(n);
        boxMean(ctx.synth, w, h, r, syn, t);
        var flatShare = new Float32Array(n);
        boxMean(ctx.flat, w, h, Math.max(1, Math.round(r / 2)), flatShare, t);
        ctx.flatShare = flatShare; ctx.flat = null;
        ctx.neutral = neutral; ctx.whiteShare = white;
        ctx.entropy = ent; ctx.brightDark = bd; ctx.greenShare = green; ctx.synthShare = syn;
      }});

      // ---------------------------------------------------------------- 5. classification
      steps.push({ label: 'Land-cover classification: 5 classes', weight: 12, run: function () {
        var base = new Uint8Array(n);
        var i, p;
        var src = ctx.rgbCls || rgba;
        for (i = 0, p = 0; i < n; i++, p += 4) {
          C.rgbToHsv(src[p], src[p + 1], src[p + 2], hsv);
          base[i] = C.classifyBase(src[p], src[p + 1], src[p + 2], hsv, ctx.lumaStd[i]);
        }
        // modal (majority) smoothing with a (2*2+1)^2 window removes salt-and-pepper noise
        var best = new Float32Array(n), share = new Float32Array(n), ind = new Float32Array(n);
        var out = new Uint8Array(n);
        out.set(base);
        for (var k = 1; k <= 4; k++) {
          for (i = 0; i < n; i++) ind[i] = base[i] === k ? 1 : 0;
          boxMean(ind, w, h, 2, share, ctx.tmp);
          for (i = 0; i < n; i++) if (share[i] > best[i]) { best[i] = share[i]; out[i] = k; }
        }
        ctx.baseClass = out;
      }});

      // ---------------------------------------------------------------- 6. waste scoring
      steps.push({ label: 'Waste scoring: combining irregularity cues', weight: 8, run: function () {
        var score = new Float32Array(n);
        var W = WEIGHTS, cvThr = s.colourVariation;
        var wsm = C.params.waterSmoothStd;
        for (var i = 0; i < n; i++) {
          if (!ctx.valid[i]) continue;
          var cv = ctx.colourVar[i];
          if (cv < cvThr) continue;                                    // hard gate: not enough colour variation
          var nCV = clamp01(cv / 70);
          var nTex = clamp01(ctx.lumaStd[i] / 45);
          var nDiv = clamp01((ctx.entropy[i] - 0.35) / 1.1);
          var nBD = clamp01(ctx.brightDark[i] / 0.15);
          var nEdge = clamp01(ctx.edge[i] / 20);
          var reg = clamp01((ctx.coherence[i] - 0.3) / 0.45);          // 1 = very regular (straight edges)
          var nIrr = nEdge * (1 - reg);
          var nCon = clamp01(ctx.contrast[i] / 40);
          var nSyn = clamp01(ctx.synthShare[i] / 0.08);
          var sc = W.cv * nCV + W.tex * nTex + W.div * nDiv + W.bd * nBD + W.irr * nIrr + W.con * nCon + W.syn * nSyn;
          // context gates
          if (ctx.baseClass[i] === CLASS.WATER && ctx.lumaStd[i] < wsm * 1.5) sc *= 0.25;   // calm water
          if (ctx.lumaStd[i] < 4) sc *= 0.3;                                                // flat surface
          if (ctx.greenShare[i] > 0.85) sc *= 0.5;                                          // homogeneous canopy / crops
          if (ctx.flatShare[i] > 0.35) sc *= Math.max(0.08, 1 - (ctx.flatShare[i] - 0.35) / 0.3);     // drawn graphics / annotations have flat colour runs
          if (ctx.neutral[i] > 0.96 && ctx.whiteShare[i] > 0.45) sc *= 0.15;                // black text / lines on white paper
          score[i] = sc;
        }
        // light smoothing so that candidate areas form contiguous blobs
        boxMean(score, w, h, Math.max(1, Math.round(r / 2)), score, ctx.tmp);
        ctx.score = score;
      }});

      // ---------------------------------------------------------------- 7. regions
      steps.push({ label: 'Region grouping: connected candidate areas', weight: 12, run: function () {
        var score = ctx.score, thr = ctx.thr, i;
        var mask = new Uint8Array(n);
        for (i = 0; i < n; i++) mask[i] = score[i] >= thr ? 1 : 0;
        ctx.rawMaskCount = 0;
        for (i = 0; i < n; i++) ctx.rawMaskCount += mask[i];

        // opening removes thin streaks (field boundaries, roads); closing joins nearby fragments
        var openR = Math.max(1, Math.round(r * 0.75));
        var closeR = Math.max(1, Math.round(r * 0.5));
        mask = morph(morph(mask, w, h, openR, false, ctx), w, h, openR, true, ctx);
        mask = morph(morph(mask, w, h, closeR, true, ctx), w, h, closeR, false, ctx);

        // connected components, 8-neighbourhood, iterative flood fill
        var labels = new Int32Array(n);
        var stack = new Int32Array(n);
        var regions = [];
        var minPx = Math.max(12, Math.round(ctx.nv * s.minRegionPct / 100));
        var next = 0, discarded = 0;
        for (var start = 0; start < n; start++) {
          if (!mask[start] || labels[start]) continue;
          next++;
          var sp = 0; stack[sp++] = start; labels[start] = next;
          var area = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, minX = w, maxX = 0, minY = h, maxY = 0, sum = 0, mx = 0, per = 0;
          while (sp > 0) {
            var cur = stack[--sp];
            var cy = (cur / w) | 0, cx = cur - cy * w;
            area++; sx += cx; sy += cy; sxx += cx * cx; syy += cy * cy; sxy += cx * cy;
            if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
            var sc = score[cur]; sum += sc; if (sc > mx) mx = sc;
            // 4-neighbour perimeter estimate
            if (cx === 0 || !mask[cur - 1]) per++;
            if (cx === w - 1 || !mask[cur + 1]) per++;
            if (cy === 0 || !mask[cur - w]) per++;
            if (cy === h - 1 || !mask[cur + w]) per++;
            for (var dy = -1; dy <= 1; dy++) {
              var ny = cy + dy; if (ny < 0 || ny >= h) continue;
              for (var dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                var nx = cx + dx; if (nx < 0 || nx >= w) continue;
                var ni = ny * w + nx;
                if (mask[ni] && !labels[ni]) { labels[ni] = next; stack[sp++] = ni; }
              }
            }
          }
          if (area < minPx) { discarded++; continue; }
          // elongation from second moments: long thin candidates are river banks, roads, field edges
          var mxx = sxx / area - (sx / area) * (sx / area) + 1 / 12;
          var myy = syy / area - (sy / area) * (sy / area) + 1 / 12;
          var mxy = sxy / area - (sx / area) * (sy / area);
          var tr = mxx + myy, det = Math.sqrt(Math.max(0, (mxx - myy) * (mxx - myy) / 4 + mxy * mxy));
          var elong = Math.sqrt((tr / 2 + det) / Math.max(1e-6, tr / 2 - det));
          if (elong > MAX_ELONGATION) { discarded++; continue; }
          // very thin shapes (outlines, frames, road edges) have a small equivalent width = 4 * area / perimeter
          var thick = 4 * area / Math.max(1, per);
          if (thick < MIN_THICKNESS_FACTOR * r) { discarded++; continue; }
          regions.push({
            tempLabel: next, area: area, cx: sx / area, cy: sy / area,
            x0: minX, y0: minY, x1: maxX, y1: maxY,
            meanScore: sum / area, maxScore: mx, perimeter: per, elongation: elong, thickness: thick
          });
        }
        regions.sort(function (a, b) { return b.area - a.area; });
        var remap = new Int32Array(next + 1);
        for (i = 0; i < regions.length; i++) {
          var rg = regions[i];
          remap[rg.tempLabel] = i + 1;
          rg.id = i + 1;
          rg.pct = rg.area / ctx.nv * 100;
          rg.score = Math.round(100 * clamp01(0.7 * rg.meanScore + 0.3 * rg.maxScore));
          rg.priority = rg.score >= 70 ? 'High' : (rg.score >= 58 ? 'Medium' : 'Low');
          rg.compactness = clamp01(4 * Math.PI * rg.area / Math.max(1, rg.perimeter * rg.perimeter));
          delete rg.tempLabel;
        }
        for (i = 0; i < n; i++) if (labels[i]) labels[i] = remap[labels[i]];
        ctx.regionMap = labels;
        ctx.regions = regions;
        ctx.discardedRegions = discarded;
        ctx.minPx = minPx;
      }});

      // ---------------------------------------------------------------- 8. statistics
      steps.push({ label: 'Statistics: land-cover distribution', weight: 8, run: function () {
        var counts = [0, 0, 0, 0, 0];
        var labelsOut = new Uint8Array(n);
        var score8 = new Uint8Array(n);
        for (var i = 0; i < n; i++) {
          if (!ctx.valid[i]) { labelsOut[i] = 5; continue; }       // 5 = excluded border / margin
          var cls = ctx.regionMap[i] > 0 ? CLASS.WASTE : ctx.baseClass[i];
          labelsOut[i] = cls;
          counts[cls]++;
          score8[i] = Math.round(clamp01(ctx.score[i]) * 255);
        }
        ctx.labels = labelsOut; ctx.score8 = score8; ctx.counts = counts;
      }});

      function finish() {
        var counts = ctx.counts;
        var pct = counts.map(function (c) { return c / ctx.nv * 100; });
        var warnings = buildWarnings(ctx, pct);
        var penalty = 0;
        warnings.forEach(function (wn) { penalty += wn.level === 'warn' ? 25 : (wn.level === 'info' ? 5 : 0); });
        var suitability = Math.max(0, 100 - penalty);
        return {
          width: w, height: h, pixels: ctx.nv, totalPixels: n, excludedPixels: n - ctx.nv, contentBox: ctx.box,
          labels: ctx.labels, score8: ctx.score8, regionMap: ctx.regionMap,
          counts: counts, percentages: pct,
          regions: ctx.regions,
          discardedRegions: ctx.discardedRegions,
          wastePct: pct[CLASS.WASTE],
          threshold: ctx.thr, windowRadius: r, minRegionPixels: ctx.minPx,
          settings: s,
          stats: ctx.stats,
          warnings: warnings,
          suitability: suitability,
          suitabilityLabel: suitability >= 75 ? 'Good' : (suitability >= 50 ? 'Fair' : 'Poor')
        };
      }

      return { steps: steps, ctx: ctx, finish: finish };
    }

    /** Reliability warnings – the system must say when it cannot classify an image well. */
    function buildWarnings(ctx, pct) {
      var out = [], st = ctx.stats, n = ctx.n;
      if (Math.min(ctx.w, ctx.h) < 96) out.push({ level: 'warn', code: 'tiny', message: 'The analysed image is very small (' + ctx.w + '×' + ctx.h + ' px). Local texture cues need more pixels; results are unreliable.' });
      if (ctx.nv < ctx.n * 0.99) out.push({ level: 'info', code: 'margins', message: ((ctx.n - ctx.nv) / ctx.n * 100).toFixed(1) + '% of the image (uniform white/black borders or margins) was excluded from the analysis.' });
      if (!ctx.s.colourCorrection && st.hueConcentration > 0.97 && st.satFraction > 0.5) out.push({ level: 'info', code: 'cast', message: 'Almost all coloured pixels share one hue, which suggests a strong colour cast (faded film, tinted scan). Enable "Colour-cast correction" in the settings and reanalyse.' });
      if (ctx.stats.correction) out.push({ level: 'info', code: 'corrected', message: 'Colour-cast correction was applied to the land-cover classification (channel gains R ' + ctx.stats.correction.gains[0].toFixed(2) + ', G ' + ctx.stats.correction.gains[1].toFixed(2) + ', B ' + ctx.stats.correction.gains[2].toFixed(2) + ') together with a contrast stretch. Waste cues use the original colours.' });
      if (st.flatFraction > 0.35) out.push({ level: 'info', code: 'graphics', message: 'A large part of the image has perfectly flat colour (' + (st.flatFraction * 100).toFixed(0) + '%), which is typical for maps, drawings or screenshots with annotations. Lines and text are ignored where possible, but a clean photograph gives much better results.' });
      if (st.meanSat < 0.04) out.push({ level: 'warn', code: 'grey', message: 'The image is almost grayscale. RGB colour cues (vegetation, water, mixed colours) cannot be used reliably.' });
      if (st.stdLuma < 8) out.push({ level: 'warn', code: 'flat', message: 'The image has very little contrast, so land-cover classes cannot be separated reliably.' });
      if (st.meanLuma < 25) out.push({ level: 'warn', code: 'dark', message: 'The image is extremely dark; colour information is mostly lost.' });
      if (st.meanLuma > 235 || st.clipBright > 0.5) out.push({ level: 'warn', code: 'bright', message: 'The image is over-exposed or mostly white; colour information is mostly lost.' });
      if (st.meanGrad < 1.2) out.push({ level: 'warn', code: 'blur', message: 'The image shows almost no fine detail (blurred or very low resolution). Texture-based cues are unreliable.' });
      if (pct[CLASS.WASTE] > 35) out.push({ level: 'warn', code: 'toomuch', message: 'More than 35% of the image was flagged. This is implausible for a typical scene and usually means textured terrain (dense urban areas, rocky ground) is being mistaken for waste. Lower the sensitivity or raise the colour-variation threshold.' });
      for (var k = 1; k <= 4; k++) {
        if (pct[k] > 97) { out.push({ level: 'info', code: 'single', message: 'Almost the whole image (' + pct[k].toFixed(0) + '%) was assigned to a single land-cover class (' + C.CLASS_INFO[k].name + '). The image may not be a typical aerial / satellite scene.' }); break; }
      }
      if (ctx.regions && ctx.regions.length === 0) out.push({ level: 'info', code: 'none', message: 'No candidate waste regions were found with the current settings. This is not proof that no waste is present – try a higher sensitivity.' });
      return out;
    }

    /** Run every step synchronously. onProgress(fraction, label). Used by the worker and by tests. */
    function runSync(job, onProgress) {
      var total = 0, i;
      for (i = 0; i < job.steps.length; i++) total += job.steps[i].weight;
      var done = 0;
      for (i = 0; i < job.steps.length; i++) {
        var st = job.steps[i];
        if (onProgress) onProgress(done / total, st.label);
        var t0 = Date.now();
        st.run();
        job.ctx.timings[st.label] = Date.now() - t0;
        done += st.weight;
      }
      if (onProgress) onProgress(1, 'Analysis complete');
      var res = job.finish();
      res.timings = job.ctx.timings;
      return res;
    }

    WS.Detection = {
      RESOLUTIONS: RESOLUTIONS,
      DEFAULT_SETTINGS: DEFAULT_SETTINGS,
      WEIGHTS: WEIGHTS,
      thresholdFor: thresholdFor,
      boxMean: boxMean,
      createJob: createJob,
      runSync: runSync
    };
  }

  var g = root;
  g.WS = g.WS || {};
  (g.WS._factories = g.WS._factories || []).push(factory);
  factory(g.WS);
})(typeof self !== 'undefined' ? self : globalThis);

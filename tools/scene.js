/*
 * WasteScan – tools/scene.js
 * -----------------------------------------------------------------------------
 * Procedural generator for a SYNTHETIC rural aerial scene (fields, forest, river,
 * roads, a village and several simulated dump sites). It is used to
 *   - create the bundled demonstration image (tools/generate-sample.js), and
 *   - drive the automated engine tests (tests/engine.test.js).
 *
 * The scene is NOT real satellite imagery and it is not a validation data-set.
 * It only exists so that the application can be demonstrated and tested offline.
 */
'use strict';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed) {
  var rnd = mulberry32(seed);
  var N = 256, perm = new Uint8Array(N), vals = new Float32Array(N);
  var i;
  for (i = 0; i < N; i++) { perm[i] = i; vals[i] = rnd(); }
  for (i = N - 1; i > 0; i--) { var j = (rnd() * (i + 1)) | 0; var t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  function lattice(ix, iy) { return vals[perm[(perm[ix & 255] + iy) & 255]]; }
  function sm(t) { return t * t * (3 - 2 * t); }
  function noise(x, y) {
    var ix = Math.floor(x), iy = Math.floor(y), fx = sm(x - ix), fy = sm(y - iy);
    var a = lattice(ix, iy), b = lattice(ix + 1, iy), c = lattice(ix, iy + 1), d = lattice(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  function fbm(x, y, oct) {
    var s = 0, amp = 0.5, f = 1;
    for (var o = 0; o < (oct || 4); o++) { s += amp * noise(x * f, y * f); amp *= 0.5; f *= 2; }
    return s / (1 - Math.pow(0.5, oct || 4));
  }
  return { noise: noise, fbm: fbm, rnd: rnd };
}

function clamp8(v) { return v < 0 ? 0 : (v > 255 ? 255 : v | 0); }

/**
 * @returns {{width:number,height:number,rgba:Uint8ClampedArray,truth:Uint8Array,dumps:Array}}
 */
function generateScene(opts) {
  opts = opts || {};
  var w = opts.width || 800, h = opts.height || 560, seed = opts.seed || 20240611;
  var withDumps = opts.dumps !== false;
  var NZ = makeNoise(seed);
  var rnd = NZ.rnd;
  var rgba = new Uint8ClampedArray(w * h * 4);
  var truth = new Uint8Array(w * h);
  var x, y, i, k;

  function put(px, py, r, g, b) {
    if (px < 0 || py < 0 || px >= w || py >= h) return;
    var p = (py * w + px) * 4;
    rgba[p] = clamp8(r); rgba[p + 1] = clamp8(g); rgba[p + 2] = clamp8(b); rgba[p + 3] = 255;
  }

  // --- parcel colours for farmland
  var crops = [
    [66, 128, 52], [92, 150, 62], [118, 164, 76], [160, 178, 92], [196, 176, 98],
    [150, 112, 78], [78, 138, 70], [208, 190, 120]
  ];
  function hash2(a, b) { return (Math.sin(a * 127.1 + b * 311.7 + seed) * 43758.5453) % 1; }

  // --- river centre line
  function riverY(px) { return h * 0.64 + 46 * Math.sin(px / 140) + 18 * Math.sin(px / 53 + 1.3); }

  // --- terrain
  for (y = 0; y < h; y++) {
    for (x = 0; x < w; x++) {
      var t = NZ.fbm(x / 190, y / 190, 3);
      var r, g, b;
      if (t < 0.40) {                            // scrub / barren land
        var m = NZ.fbm(x / 9, y / 9, 3);
        r = 188 + (m - 0.5) * 40; g = 158 + (m - 0.5) * 36; b = 118 + (m - 0.5) * 30;
      } else if (t < 0.60) {                     // farmland parcels
        var ang = 0.35, cx = x * Math.cos(ang) + y * Math.sin(ang), cy = -x * Math.sin(ang) + y * Math.cos(ang);
        var gx = Math.floor(cx / 70), gy = Math.floor(cy / 52);
        var hh = Math.abs(hash2(gx, gy));
        var cc = crops[Math.floor(hh * crops.length) % crops.length];
        var stripe = 0.5 + 0.5 * Math.sin(cx * 0.9 + gx * 2.0);
        var fn = NZ.fbm(x / 5, y / 5, 2) - 0.5;
        r = cc[0] + fn * 22 + stripe * 6; g = cc[1] + fn * 22 + stripe * 6; b = cc[2] + fn * 16 + stripe * 3;
      } else {                                   // forest / dense trees
        var cr = NZ.fbm(x / 5, y / 5, 3);
        var cr2 = NZ.fbm(x / 22, y / 22, 2);
        var d = (cr - 0.5) * 60 + (cr2 - 0.5) * 30;
        r = 34 + d * 0.5; g = 82 + d * 0.9; b = 36 + d * 0.4;
      }
      put(x, y, r + (rnd() - 0.5) * 5, g + (rnd() - 0.5) * 5, b + (rnd() - 0.5) * 5);
    }
  }

  // --- pond
  var pondX = w * 0.18, pondY = h * 0.22;
  for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
    var dx = (x - pondX) / 44, dy = (y - pondY) / 28;
    var dd = dx * dx + dy * dy + 0.12 * Math.sin(Math.atan2(dy, dx) * 5);
    if (dd < 1) { var n2 = NZ.fbm(x / 30, y / 30, 2) - 0.5; put(x, y, 36 + n2 * 10, 96 + n2 * 14, 130 + n2 * 14); }
  }

  // --- river
  for (x = 0; x < w; x++) {
    var cy0 = riverY(x), wd = 13 + 4 * Math.sin(x / 90);
    for (y = Math.floor(cy0 - wd - 4); y <= Math.ceil(cy0 + wd + 4); y++) {
      var dist = Math.abs(y - cy0);
      var nn = NZ.fbm(x / 40, y / 40, 2) - 0.5;
      if (dist < wd) put(x, y, 40 + nn * 12, 88 + nn * 14, 118 + nn * 14);
      else if (dist < wd + 3) put(x, y, 196, 178, 138);          // sandy bank
    }
  }

  // --- roads (grey, straight)
  function line(x0, y0, x1, y1, wd, col) {
    var len = Math.hypot(x1 - x0, y1 - y0), steps = Math.ceil(len * 2);
    for (var s = 0; s <= steps; s++) {
      var u = s / steps, px = x0 + (x1 - x0) * u, py = y0 + (y1 - y0) * u;
      for (var oy = -wd; oy <= wd; oy++) for (var ox = -wd; ox <= wd; ox++) {
        if (ox * ox + oy * oy <= wd * wd) put(Math.round(px + ox), Math.round(py + oy), col[0] + (rnd() - 0.5) * 6, col[1] + (rnd() - 0.5) * 6, col[2] + (rnd() - 0.5) * 6);
      }
    }
  }
  line(0, h * 0.35, w, h * 0.30, 3, [122, 122, 126]);
  line(w * 0.55, 0, w * 0.45, h, 3, [128, 126, 124]);

  // --- village with small buildings
  var vx0 = w * 0.62, vy0 = h * 0.10, vw = 170, vh = 110;
  for (y = vy0; y < vy0 + vh; y++) for (x = vx0; x < vx0 + vw; x++) {
    put(Math.floor(x), Math.floor(y), 176 + (rnd() - 0.5) * 8, 160 + (rnd() - 0.5) * 8, 134 + (rnd() - 0.5) * 8);
  }
  var roofs = [[150, 72, 56], [140, 140, 146], [226, 226, 220], [72, 104, 150], [168, 96, 70], [110, 110, 112]];
  for (k = 0; k < 46; k++) {
    var bw = 8 + Math.floor(rnd() * 10), bh = 8 + Math.floor(rnd() * 10);
    var bx = Math.floor(vx0 + 6 + rnd() * (vw - bw - 12)), by = Math.floor(vy0 + 6 + rnd() * (vh - bh - 12));
    var rc = roofs[Math.floor(rnd() * roofs.length)];
    for (y = by; y < by + bh; y++) for (x = bx; x < bx + bw; x++) {
      var shade = (x - bx) < bw / 2 ? 1.0 : 0.88;
      put(x, y, rc[0] * shade + (rnd() - 0.5) * 6, rc[1] * shade + (rnd() - 0.5) * 6, rc[2] * shade + (rnd() - 0.5) * 6);
    }
    for (x = bx; x < bx + bw + 2; x++) put(x, by + bh, 70, 66, 60);
  }

  // --- distractor: a smooth blue-roofed warehouse and a pale quarry (should NOT be flagged)
  for (y = h * 0.80; y < h * 0.80 + 24; y++) for (x = w * 0.08; x < w * 0.08 + 56; x++) put(Math.floor(x), Math.floor(y), 66 + (rnd() - 0.5) * 4, 104 + (rnd() - 0.5) * 4, 158 + (rnd() - 0.5) * 4);

  // --- dump sites
  var dumps = [];
  if (withDumps) {
    var sites = [
      { cx: w * 0.30, cy: h * 0.50, R: 40 },
      { cx: w * 0.78, cy: h * 0.82, R: 34 },
      { cx: w * 0.11, cy: h * 0.60, R: 26 },
      { cx: w * 0.50, cy: h * 0.18, R: 30 }
    ];
    var palette = [
      [236, 236, 232, 1.4], [88, 140, 212, 1.0], [222, 118, 160, 0.8], [26, 26, 30, 1.3],
      [112, 82, 56, 1.6], [150, 150, 152, 1.2], [210, 130, 52, 0.7], [244, 214, 70, 0.5], [70, 126, 70, 0.6]
    ];
    var totalW = 0; palette.forEach(function (c) { totalW += c[3]; });
    function pick() {
      var u = rnd() * totalW, a = 0;
      for (var q = 0; q < palette.length; q++) { a += palette[q][3]; if (u <= a) return palette[q]; }
      return palette[0];
    }
    sites.forEach(function (st, si) {
      var phase = rnd() * 6.28, bboxArea = 0;
      var x0 = Math.floor(st.cx - st.R * 1.5), x1 = Math.ceil(st.cx + st.R * 1.5);
      var y0 = Math.floor(st.cy - st.R * 1.5), y1 = Math.ceil(st.cy + st.R * 1.5);
      var inside = function (px, py) {
        var ddx = px - st.cx, ddy = (py - st.cy) * 1.15;
        var rr = Math.hypot(ddx, ddy), th = Math.atan2(ddy, ddx);
        var lim = st.R * (0.72 + 0.28 * Math.sin(th * 3 + phase) * 0.6 + 0.2 * Math.sin(th * 7 + phase * 2));
        return rr < lim ? 1 - rr / lim : 0;     // depth 0..1 inside
      };
      // soil base + debris particles
      var cellMap = {};
      for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) {
        var depth = inside(x, y);
        if (depth <= 0) continue;
        truth[y * w + x] = 1; bboxArea++;
        var ck = Math.floor(x / 3) + ',' + Math.floor(y / 3);
        if (!(ck in cellMap)) cellMap[ck] = rnd() < 0.18 + 0.7 * Math.min(1, depth * 2.2) ? pick() : null;
        var cc = cellMap[ck];
        if (cc) put(x, y, cc[0] + (rnd() - 0.5) * 22, cc[1] + (rnd() - 0.5) * 22, cc[2] + (rnd() - 0.5) * 22);
        else put(x, y, 108 + (rnd() - 0.5) * 30, 84 + (rnd() - 0.5) * 26, 60 + (rnd() - 0.5) * 22);
      }
      // a few larger fragments (bags, sheets, appliances)
      for (k = 0; k < 14; k++) {
        var a = rnd() * 6.28, rr = rnd() * st.R * 0.6;
        var fx = Math.round(st.cx + Math.cos(a) * rr), fy = Math.round(st.cy + Math.sin(a) * rr);
        var fw = 3 + Math.floor(rnd() * 8), fh = 3 + Math.floor(rnd() * 6), fc = pick();
        for (var yy = 0; yy < fh; yy++) for (var xx = 0; xx < fw; xx++) {
          if (inside(fx + xx, fy + yy) > 0) put(fx + xx, fy + yy, fc[0] + (rnd() - 0.5) * 14, fc[1] + (rnd() - 0.5) * 14, fc[2] + (rnd() - 0.5) * 14);
        }
      }
      dumps.push({ id: si + 1, cx: st.cx, cy: st.cy, radius: st.R, area: bboxArea });
    });
  }

  // --- final sensor-like noise
  for (i = 0; i < w * h; i++) {
    var nz = (rnd() - 0.5) * 6;
    rgba[i * 4] = clamp8(rgba[i * 4] + nz); rgba[i * 4 + 1] = clamp8(rgba[i * 4 + 1] + nz); rgba[i * 4 + 2] = clamp8(rgba[i * 4 + 2] + nz);
  }
  return { width: w, height: h, rgba: rgba, truth: truth, dumps: dumps };
}

module.exports = { generateScene: generateScene, mulberry32: mulberry32, makeNoise: makeNoise };

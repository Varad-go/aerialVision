/*
 * WasteScan – visualization.js : the interactive image viewer.
 * Views: Original · Processed (land-cover map) · Detection overlay · Score heat-map · Before/after comparison.
 * Every coloured pixel shown here is taken from the label map produced by the image-processing pipeline.
 */
(function () {
  'use strict';
  var WS = window.WS = window.WS || {};
  var U = WS.U, $ = U.$;

  var HINT = 'Hover over the image to inspect a pixel. Keys: 1–5 views · + / − zoom · 0 fit · F full screen.';
  var MAX_DISPLAY = 1600;           // longest side of the display canvas
  var els = {};
  var S = {                         // viewer state
    analysis: null, view: 'overlay', zoom: 1, fit: true, compare: 0.5,
    orig: null, layers: null, dw: 0, dh: 0, aw: 0, ah: 0, raf: 0
  };

  function settings() { return WS.state.settings; }

  /* ---------------------------------------------------------------- layer construction */
  function makeCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  function buildLayers(res) {
    var w = res.width, h = res.height, n = w * h;
    var CI = WS.Classifier.CLASS_INFO;
    var cls = makeCanvas(w, h), other = makeCanvas(w, h), waste = makeCanvas(w, h), heat = makeCanvas(w, h);
    var ic = cls.getContext('2d').createImageData(w, h), io = other.getContext('2d').createImageData(w, h),
        iw = waste.getContext('2d').createImageData(w, h), ih = heat.getContext('2d').createImageData(w, h);
    var i, p, c, col;
    for (i = 0, p = 0; i < n; i++, p += 4) {
      c = res.labels[i];
      if (c > 4) continue;                       // excluded border / margin: leave transparent
      col = CI[c].color;
      ic.data[p] = col[0]; ic.data[p + 1] = col[1]; ic.data[p + 2] = col[2]; ic.data[p + 3] = 255;
      if (c === 0) { iw.data[p] = 255; iw.data[p + 1] = 23; iw.data[p + 2] = 38; iw.data[p + 3] = 255; }
      else { io.data[p] = col[0]; io.data[p + 1] = col[1]; io.data[p + 2] = col[2]; io.data[p + 3] = 255; }
      // heat-map ramp: green → yellow → orange → red, transparent for very low scores
      var t = res.score8[i] / 255;
      var r, g, b, a;
      if (t < 0.5) { var u = t / 0.5; r = 27 + (253 - 27) * u; g = 94 + (216 - 94) * u; b = 58 + (53 - 58) * u; }
      else { var v = (t - 0.5) / 0.5; r = 253 + (229 - 253) * v; g = 216 + (57 - 216) * v; b = 53; }
      a = t < 0.08 ? 0 : 255;
      ih.data[p] = r; ih.data[p + 1] = g; ih.data[p + 2] = b; ih.data[p + 3] = a;
    }
    cls.getContext('2d').putImageData(ic, 0, 0);
    other.getContext('2d').putImageData(io, 0, 0);
    waste.getContext('2d').putImageData(iw, 0, 0);
    heat.getContext('2d').putImageData(ih, 0, 0);
    return { cls: cls, other: other, waste: waste, heat: heat };
  }

  /* ---------------------------------------------------------------- drawing */
  function drawRegions(ctx, sx, sy, scale, hot, onlyHot) {
    var regs = S.analysis.result.regions;
    ctx.save();
    ctx.lineWidth = Math.max(1.5, 2 * scale); ctx.strokeStyle = '#ff1744';
    ctx.font = '700 ' + Math.round(12 * Math.max(1, scale)) + 'px "Segoe UI", Arial, sans-serif'; ctx.textBaseline = 'middle';
    regs.forEach(function (r) {
      if (onlyHot && r.id !== hot) return;
      var isHot = r.id === hot;
      ctx.strokeStyle = isHot ? '#ffeb3b' : '#ff1744';
      ctx.lineWidth = Math.max(1.5, (isHot ? 4 : 2) * scale);
      var x = (r.x0 - 1) * sx, y = (r.y0 - 1) * sy, w = (r.x1 - r.x0 + 3) * sx, h = (r.y1 - r.y0 + 3) * sy;
      ctx.strokeRect(x, y, w, h);
      var label = 'R' + r.id, pad = 4 * scale, tw = ctx.measureText(label).width + pad * 2, th = 18 * Math.max(1, scale);
      var ty = y - th < 0 ? y + h : y - th;
      ctx.fillStyle = isHot ? '#f9a825' : '#ff1744'; ctx.fillRect(x, ty, tw, th);
      ctx.fillStyle = '#fff'; ctx.fillText(label, x + pad, ty + th / 2 + 1);
    });
    ctx.restore();
  }

  /** Paint one view on a 2D context sized dw × dh (used by the viewer and by exports). */
  function paint(ctx, mode, o) {
    var dw = o.dw, dh = o.dh, L = S.layers;
    ctx.clearRect(0, 0, dw, dh);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    if (mode === 'processed') {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(L.cls, 0, 0, dw, dh);
      return;
    }
    ctx.drawImage(S.orig, 0, 0, dw, dh);
    if (mode === 'original') return;
    var op = o.opacity;
    if (mode === 'heatmap') {
      ctx.globalAlpha = Math.max(0.15, op); ctx.drawImage(L.heat, 0, 0, dw, dh); ctx.globalAlpha = 1;
      return;
    }
    // detection overlay
    if (o.classes) { ctx.globalAlpha = op * 0.5; ctx.drawImage(L.other, 0, 0, dw, dh); }
    ctx.globalAlpha = op; ctx.drawImage(L.waste, 0, 0, dw, dh);
    ctx.globalAlpha = 1;
    if (o.labels) drawRegions(ctx, dw / S.aw, dh / S.ah, Math.max(1, dw / 900), o.hot, false);
    else if (o.hot) drawRegions(ctx, dw / S.aw, dh / S.ah, Math.max(1, dw / 900), o.hot, true);
  }

  function opts() { var s = settings(); return { dw: S.dw, dh: S.dh, opacity: s.overlayOpacity / 100, classes: !!s.showClasses, labels: !!s.showLabels, hot: S.hot || 0 }; }

  /* ---------------------------------------------------------------- viewer plumbing */
  function render() {
    if (!S.analysis) return;
    var o = opts();
    if (els.cvA.width !== S.dw) { els.cvA.width = S.dw; els.cvA.height = S.dh; els.cvB.width = S.dw; els.cvB.height = S.dh; }
    if (S.view === 'compare') {
      paint(els.cvA.getContext('2d'), 'original', o);
      paint(els.cvB.getContext('2d'), 'overlay', o);
    } else {
      paint(els.cvA.getContext('2d'), S.view, o);
    }
    applyCompare();
  }
  function scheduleRender() { if (S.raf) return; S.raf = requestAnimationFrame(function () { S.raf = 0; render(); }); }

  function applyCompare() {
    var on = S.view === 'compare';
    els.cvB.style.display = on ? 'block' : 'none';
    els.handle.hidden = !on; els.tagL.hidden = !on; els.tagR.hidden = !on;
    if (on) {
      var w = S.dw * S.zoom;
      els.cvB.style.clipPath = 'inset(0 0 0 ' + (S.compare * 100) + '%)';
      els.handle.style.left = (S.compare * w) + 'px';
    }
  }

  function applyZoom() {
    var w = Math.round(S.dw * S.zoom), h = Math.round(S.dh * S.zoom);
    [els.cvA, els.cvB].forEach(function (c) { c.style.width = w + 'px'; c.style.height = h + 'px'; });
    els.stage.style.width = w + 'px'; els.stage.style.height = h + 'px';
    els.zoomLabel.textContent = Math.round(S.zoom * 100) + '%';
    applyCompare();
  }
  function fitZoom() {
    var avail = els.scroll.clientWidth - 2;
    return U.clamp(avail / S.dw, 0.05, 2);
  }
  function setZoom(z, cx, cy) {
    z = U.clamp(z, 0.05, 8);
    var sc = els.scroll;
    var rect = els.stage.getBoundingClientRect();
    var ax = cx != null ? cx - rect.left : S.dw * S.zoom / 2, ay = cy != null ? cy - rect.top : S.dh * S.zoom / 2;
    var fx = ax / (S.dw * S.zoom), fy = ay / (S.dh * S.zoom);
    var vx = cx != null ? cx - sc.getBoundingClientRect().left : sc.clientWidth / 2, vy = cy != null ? cy - sc.getBoundingClientRect().top : sc.clientHeight / 2;
    S.zoom = z; S.fit = false;
    applyZoom();
    sc.scrollLeft = fx * S.dw * z - vx; sc.scrollTop = fy * S.dh * z - vy;
  }
  function resetZoom() { S.fit = true; S.zoom = fitZoom(); applyZoom(); els.scroll.scrollLeft = 0; els.scroll.scrollTop = 0; }

  function setView(mode) {
    S.view = mode;
    document.querySelectorAll('#viewTabs .seg-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === mode); });
    var overlayish = mode === 'overlay' || mode === 'compare';
    $('#viewerOpacity').disabled = !(overlayish || mode === 'heatmap');
    $('#toggleClasses').disabled = !overlayish; $('#toggleLabels').disabled = !overlayish;
    els.legend.innerHTML = WS.legendHTML({ heat: mode === 'heatmap' });
    render();
  }

  function setAnalysis(analysis) {
    var res = analysis.result, src = analysis.source;
    var keep = !!S.analysis && S.analysis.originalWidth === analysis.originalWidth && S.analysis.originalHeight === analysis.originalHeight && !S.fit;
    var kz = S.zoom, ksl = els.scroll.scrollLeft, kst = els.scroll.scrollTop;
    S.hot = 0;
    S.analysis = analysis; S.aw = res.width; S.ah = res.height;
    var sc = Math.min(1, MAX_DISPLAY / Math.max(analysis.originalWidth, analysis.originalHeight));
    S.dw = Math.max(1, Math.round(analysis.originalWidth * sc)); S.dh = Math.max(1, Math.round(analysis.originalHeight * sc));
    S.orig = makeCanvas(S.dw, S.dh);
    var c = S.orig.getContext('2d'); c.imageSmoothingQuality = 'high';
    c.fillStyle = '#fff'; c.fillRect(0, 0, S.dw, S.dh);
    c.drawImage(src.img, 0, 0, S.dw, S.dh);
    S.layers = buildLayers(res);
    els.cvA.width = els.cvB.width = S.dw; els.cvA.height = els.cvB.height = S.dh;
    setView(S.view || 'overlay');
    // size the viewer once the page is visible
    requestAnimationFrame(function () {
      if (keep) { S.zoom = kz; S.fit = false; applyZoom(); els.scroll.scrollLeft = ksl; els.scroll.scrollTop = kst; } else resetZoom();
    });
  }

  function clear() {
    S.analysis = null; S.orig = null; S.layers = null;
    [els.cvA, els.cvB].forEach(function (c) { c.width = 1; c.height = 1; });
  }

  function focusRegion(id) {
    if (!S.analysis) return;
    var r = S.analysis.result.regions.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    setView('overlay');
    var z = U.clamp(Math.min(els.scroll.clientWidth, els.scroll.clientHeight) / (Math.max(r.x1 - r.x0, r.y1 - r.y0) * (S.dw / S.aw) * 2.2), 1, 6);
    S.zoom = z; S.fit = false; applyZoom();
    els.scroll.scrollLeft = r.cx * (S.dw / S.aw) * z - els.scroll.clientWidth / 2;
    els.scroll.scrollTop = r.cy * (S.dh / S.ah) * z - els.scroll.clientHeight / 2;
    $('#viewerCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------------------------------------------------------- exports */
  function exportCanvas(mode, maxSide, o) {
    if (!S.analysis) return null;
    var sc = Math.min(1, (maxSide || MAX_DISPLAY) / Math.max(S.dw, S.dh));
    var w = Math.round(S.dw * sc), h = Math.round(S.dh * sc);
    var c = makeCanvas(w, h), s = settings();
    paint(c.getContext('2d'), mode, Object.assign({ dw: w, dh: h, opacity: s.overlayOpacity / 100, classes: !!s.showClasses, labels: !!s.showLabels }, o || {}));
    return c;
  }

  /** Detection image with a legend / caption strip underneath (used for "Download Detection Image"). */
  function exportAnnotated() {
    var base = exportCanvas('overlay', MAX_DISPLAY);
    if (!base) return null;
    var CI = WS.Classifier.CLASS_INFO, pad = 14, bar = 64;
    var c = makeCanvas(base.width, base.height + bar), ctx = c.getContext('2d');
    ctx.drawImage(base, 0, 0);
    ctx.fillStyle = '#0e2e22'; ctx.fillRect(0, base.height, c.width, bar);
    ctx.font = '600 13px "Segoe UI", Arial, sans-serif'; ctx.textBaseline = 'middle';
    var x = pad, y = base.height + 20;
    CI.forEach(function (k) {
      var label = k.id === 0 ? 'Suspected waste' : k.short;
      var tw = ctx.measureText(label).width;
      if (x + tw + 36 > c.width - pad) { x = pad; y += 20; }
      ctx.fillStyle = k.hex; ctx.fillRect(x, y - 6, 12, 12);
      ctx.fillStyle = '#e5f3eb'; ctx.fillText(label, x + 18, y);
      x += tw + 38;
    });
    ctx.font = '12px "Segoe UI", Arial, sans-serif'; ctx.fillStyle = '#8fe0b5';
    var a = S.analysis, cap = 'WasteScan · ' + a.filename + ' · ' + a.result.wastePct.toFixed(2) + '% suspected waste · ' + a.result.regions.length + ' region(s) · heuristic estimate – requires human verification';
    ctx.fillText(cap, pad, base.height + bar - 12);
    return c;
  }

  function thumb(mode, maxSide, quality) {
    var c = exportCanvas(mode, maxSide || 360, { labels: false, classes: false });
    return c ? c.toDataURL('image/jpeg', quality || 0.72) : null;
  }

  /* ---------------------------------------------------------------- interaction */
  function pointerToAnalysis(ev) {
    var rect = els.stage.getBoundingClientRect();
    var fx = (ev.clientX - rect.left) / rect.width, fy = (ev.clientY - rect.top) / rect.height;
    if (fx < 0 || fy < 0 || fx > 1 || fy > 1) return null;
    return { x: Math.min(S.aw - 1, Math.floor(fx * S.aw)), y: Math.min(S.ah - 1, Math.floor(fy * S.ah)), ox: fx * S.dw, oy: fy * S.dh };
  }

  function bindInteraction() {
    // view tabs and tools
    document.querySelectorAll('#viewTabs .seg-btn').forEach(function (b) { b.addEventListener('click', function () { setView(b.getAttribute('data-view')); }); });
    $('#zoomIn').addEventListener('click', function () { setZoom(S.zoom * 1.25); });
    $('#zoomOut').addEventListener('click', function () { setZoom(S.zoom / 1.25); });
    $('#zoomReset').addEventListener('click', resetZoom);
    $('#fullscreenBtn').addEventListener('click', toggleFullscreen);
    WS.bus.on('overlay:change', scheduleRender);

    els.scroll.addEventListener('wheel', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom(S.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
    }, { passive: false });

    // drag to pan
    var pan = null;
    els.scroll.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.compare-handle') || e.button !== 0) return;
      if (S.view === 'compare') { var rect = els.stage.getBoundingClientRect(); S.compare = U.clamp((e.clientX - rect.left) / rect.width, 0, 1); applyCompare(); }
      pan = { x: e.clientX, y: e.clientY, sl: els.scroll.scrollLeft, st: els.scroll.scrollTop };
      els.scroll.classList.add('panning');
      try { els.scroll.setPointerCapture(e.pointerId); } catch (err) {}
    });
    els.scroll.addEventListener('pointermove', function (e) {
      if (pan && S.view !== 'compare') { els.scroll.scrollLeft = pan.sl - (e.clientX - pan.x); els.scroll.scrollTop = pan.st - (e.clientY - pan.y); }
      else if (pan && S.view === 'compare') { var rect = els.stage.getBoundingClientRect(); S.compare = U.clamp((e.clientX - rect.left) / rect.width, 0, 1); applyCompare(); }
      readout(e);
      if (!pan && S.analysis && S.view !== 'compare') {
        var hid = regionAt(e);
        els.scroll.classList.toggle('over-region', !!hid);
        if (hid !== (S.hot || 0)) { S.hot = hid; scheduleRender(); WS.bus.emit('region:hover', hid); }
      }
    });
    function regionAt(e) {
      var p = S.analysis && pointerToAnalysis(e);
      return p ? S.analysis.result.regionMap[p.y * S.aw + p.x] : 0;
    }
    function endPan(e) {
      if (pan && e.type === 'pointerup' && S.view !== 'compare' && Math.hypot(e.clientX - pan.x, e.clientY - pan.y) < 4) {
        var rid = regionAt(e); if (rid) WS.bus.emit('region:select', rid);
      }
      pan = null; els.scroll.classList.remove('panning'); try { els.scroll.releasePointerCapture(e.pointerId); } catch (err) {} }
    els.scroll.addEventListener('pointerup', endPan);
    els.scroll.addEventListener('pointercancel', endPan);
    els.scroll.addEventListener('pointerleave', function () { els.readout.textContent = HINT; if (S.hot) { S.hot = 0; scheduleRender(); WS.bus.emit('region:hover', 0); } });
    WS.bus.on('region:select', function (id) { S.hot = id; scheduleRender(); });

    // compare handle drag
    var drag = false;
    els.handle.addEventListener('pointerdown', function (e) { drag = true; els.handle.setPointerCapture(e.pointerId); e.stopPropagation(); e.preventDefault(); });
    els.handle.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var rect = els.stage.getBoundingClientRect(); S.compare = U.clamp((e.clientX - rect.left) / rect.width, 0, 1); applyCompare();
    });
    els.handle.addEventListener('pointerup', function () { drag = false; });

    window.addEventListener('resize', U.debounce(function () { if (S.analysis && S.fit && els.scroll.clientWidth > 0) resetZoom(); }, 120));
    document.addEventListener('fullscreenchange', function () { setTimeout(function () { if (S.fit) resetZoom(); }, 60); });
    WS.bus.on('page:show', function (p) { if (p === 'results' && S.analysis && S.fit) setTimeout(resetZoom, 30); });
  }

  function readout(e) {
    if (!S.analysis) return;
    var p = pointerToAnalysis(e);
    if (!p) return;
    var res = S.analysis.result, i = p.y * S.aw + p.x, CI = WS.Classifier.CLASS_INFO;
    var rid = res.regionMap[i];
    var sc = S.analysis.prep.scale || 1;
    var cname = res.labels[i] > 4 ? 'Excluded border / margin' : CI[res.labels[i]].name;
    els.readout.textContent = 'x ' + Math.round(p.x / sc) + ', y ' + Math.round(p.y / sc) + ' · ' + cname + (rid ? ' (region R' + rid + ')' : '') + ' · waste score ' + (res.score8[i] / 255).toFixed(2);
  }

  function toggleFullscreen() {
    var card = $('#viewerCard');
    if (document.fullscreenEnabled && card.requestFullscreen) {
      if (document.fullscreenElement) document.exitFullscreen(); else card.requestFullscreen().catch(function () { fallbackFs(card); });
    } else fallbackFs(card);
  }
  function fallbackFs(card) { card.classList.toggle('is-fs'); document.body.style.overflow = card.classList.contains('is-fs') ? 'hidden' : ''; setTimeout(function () { if (S.fit) resetZoom(); }, 60); }

  function init() {
    els = {
      scroll: $('#viewerScroll'), stage: $('#viewerStage'), cvA: $('#cvA'), cvB: $('#cvB'), handle: $('#compareHandle'),
      tagL: $('#tagL'), tagR: $('#tagR'), zoomLabel: $('#zoomLabel'), legend: $('#legend'), readout: $('#pixelReadout')
    };
    bindInteraction();
    document.addEventListener('keydown', function (e) {
      if (!S.analysis || document.body.getAttribute('data-page') !== 'results') return;
      if (/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      var m = { '1': 'original', '2': 'processed', '3': 'overlay', '4': 'heatmap', '5': 'compare' };
      if (m[e.key]) setView(m[e.key]);
      else if (e.key === '+' || e.key === '=') setZoom(S.zoom * 1.25);
      else if (e.key === '-') setZoom(S.zoom / 1.25);
      else if (e.key === '0') resetZoom();
      else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { var c = $('#viewerCard'); if (c.classList.contains('is-fs')) fallbackFs(c); } });
  }

  WS.Viewer = {
    init: init, setAnalysis: setAnalysis, clear: clear, setView: setView, focusRegion: focusRegion,
    exportCanvas: exportCanvas, exportAnnotated: exportAnnotated, thumb: thumb, resetZoom: resetZoom,
    hasAnalysis: function () { return !!S.analysis; },
    setHot: function (id) { S.hot = id; scheduleRender(); }
  };
})();

/*
 * WasteScan – history.js : analysis history stored in the browser's localStorage only.
 * Stores statistics, a short summary and two small thumbnails per analysis – never the full-size image.
 */
(function () {
  'use strict';
  var WS = window.WS = window.WS || {};
  var U = WS.U, $ = U.$;

  var KEY = 'wastescan.history.v1';
  var MAX_ENTRIES = 30;
  var entries = [];

  function load() {
    var data = U.store.get(KEY, []);
    entries = Array.isArray(data) ? data.filter(function (e) { return e && e.id && typeof e.wastePct === 'number'; }) : [];
  }

  function persist() {
    // localStorage has a small quota; shed thumbnails (oldest first) and then entries if saving fails
    var copy = entries.slice();
    for (var guard = 0; guard < 80; guard++) {
      if (U.store.set(KEY, copy)) { entries = copy; return true; }
      var victim = null;
      for (var i = copy.length - 1; i >= 0; i--) if (copy[i].thumb || copy[i].overlayThumb) { victim = copy[i]; break; }
      if (victim) { victim.thumb = null; victim.overlayThumb = null; }
      else if (copy.length > 1) copy.pop();
      else break;
    }
    return false;
  }

  function all() { return entries.slice(); }

  function toEntry(a) {
    var r = a.result, sc = a.prep.scale || 1;
    return {
      id: a.id, filename: a.filename, date: a.date, sample: false,
      width: a.originalWidth, height: a.originalHeight, analysedWidth: r.width, analysedHeight: r.height, fileSize: a.fileSize,
      wastePct: r.wastePct, regionsCount: r.regions.length,
      counts: r.counts.slice(), percentages: r.percentages.slice(),
      priorities: WS.Results.priorityCounts(r.regions),
      regions: r.regions.slice(0, 40).map(function (g) {
        return { id: g.id, area: g.area, pct: g.pct, score: g.score, priority: g.priority, cx: Math.round(g.cx / sc), cy: Math.round(g.cy / sc) };
      }),
      settings: a.settings, gsd: a.settings.gsd || 0, threshold: r.threshold,
      suitability: r.suitability, suitabilityLabel: r.suitabilityLabel,
      warnings: r.warnings.map(function (w) { return w.message; }),
      summary: a.summary, elapsedMs: a.elapsedMs,
      thumb: WS.Viewer.thumb('original', 320, 0.7), overlayThumb: WS.Viewer.thumb('overlay', 320, 0.7)
    };
  }

  function add(analysis) {
    try {
      entries.unshift(toEntry(analysis));
      if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
      if (!persist()) U.toast('The analysis could not be saved to the browser history (storage is full or disabled).', 'warn');
    } catch (e) {
      console.error('[WasteScan] history save failed', e);
      U.toast('The analysis could not be saved to the history.', 'warn');
    }
    WS.bus.emit('history:changed');
  }

  function remove(id) {
    entries = entries.filter(function (e) { return e.id !== id; });
    persist(); WS.bus.emit('history:changed'); U.toast('History entry deleted.');
  }
  function clear() {
    entries = []; persist(); WS.bus.emit('history:changed'); U.toast('All history cleared.');
  }

  function render() {
    var list = $('#historyList');
    $('#historyEmpty').hidden = entries.length > 0;
    $('#clearHistoryBtn').hidden = entries.length === 0;
    list.innerHTML = entries.map(function (e) {
      var pr = e.priorities || {};
      var level = pr.High ? 'high' : pr.Medium ? 'medium' : 'low';
      var pill = e.regionsCount ? '<span class="pill pill-' + level + '">' + (pr.High ? 'High' : pr.Medium ? 'Medium' : 'Low') + ' priority</span>' : '';
      return '<article class="history-card" data-id="' + e.id + '">' +
        '<div class="history-thumb">' + (e.overlayThumb ? '<img alt="Detection overlay thumbnail" src="' + e.overlayThumb + '">' : '') + pill + '</div>' +
        '<div class="history-body"><h4>' + U.escapeHtml(e.filename) + '</h4><time datetime="' + e.date + '">' + U.fmtDate(e.date) + '</time>' +
        '<div class="history-stats"><div><b>' + e.wastePct.toFixed(2) + '%</b><span>Waste cover</span></div><div><b>' + e.regionsCount + '</b><span>Regions</span></div><div><b>' + (e.suitabilityLabel || '—') + '</b><span>Input</span></div></div>' +
        '<p class="history-sum">' + U.escapeHtml(e.summary || '') + '</p></div>' +
        '<div class="history-actions"><button class="btn btn-outline" data-act="view">' + U.icon('eye') + 'View</button><button class="btn btn-outline danger" data-act="delete">' + U.icon('trash') + 'Delete</button></div></article>';
    }).join('');
  }

  function view(id) {
    var e = entries.filter(function (x) { return x.id === id; })[0];
    if (!e) { U.toast('That history entry no longer exists.', 'warn'); return; }
    var CI = WS.Classifier.CLASS_INFO;
    var rows = (e.regions || []).map(function (g) {
      return '<tr><td><b>R' + g.id + '</b></td><td>' + g.cx + ', ' + g.cy + '</td><td class="num">' + U.fmtInt(g.area) + '</td><td class="num">' + g.pct.toFixed(2) + '%</td><td class="num">' + g.score + ' / 100</td><td><span class="pill pill-' + g.priority.toLowerCase() + '">' + g.priority + ' Priority</span></td></tr>';
    }).join('') || '<tr class="empty-row"><td colspan="6">No candidate regions were detected.</td></tr>';
    var ha = e.gsd > 0 ? ' · ≈ ' + U.fmtHa(U.hectares(e.width * e.height, e.gsd)) + ' analysed' : '';
    var html =
      '<p class="muted">' + U.fmtDate(e.date) + ' · ' + e.width + '×' + e.height + ' px (analysed at ' + e.analysedWidth + '×' + e.analysedHeight + ' px) · ' + U.fmtBytes(e.fileSize || 0) + ha + '</p>' +
      '<div class="modal-grid"><figure>' + (e.thumb ? '<img alt="Original thumbnail" src="' + e.thumb + '">' : '') + '<figcaption>Original (thumbnail)</figcaption></figure>' +
      '<figure>' + (e.overlayThumb ? '<img alt="Overlay thumbnail" src="' + e.overlayThumb + '">' : '') + '<figcaption>Detection overlay (thumbnail)</figcaption></figure></div>' +
      '<div class="alert alert-info">' + U.icon('info') + '<span>Only statistics and small thumbnails are stored. To see the full-size overlay again, upload the image and analyse it again.</span></div>' +
      '<div class="modal-grid" style="margin-top:16px"><div class="card"><h3 style="margin-bottom:10px">Land-cover distribution</h3><div id="mDonut" class="chart-box"></div></div>' +
      '<div class="card"><h3 style="margin-bottom:10px">Key figures</h3><div class="summary-text"><p><b>Suspected waste coverage:</b> ' + e.wastePct.toFixed(2) + '%</p><p><b>Candidate regions:</b> ' + e.regionsCount + ' (' + (e.priorities.High || 0) + ' High, ' + (e.priorities.Medium || 0) + ' Medium, ' + (e.priorities.Low || 0) + ' Low)</p>' +
      '<p><b>Settings:</b> sensitivity ' + e.settings.sensitivity + ', colour variation ' + e.settings.colourVariation + ', min. region ' + (+e.settings.minRegionPct).toFixed(2) + '%, resolution ' + e.settings.resolution + '</p>' +
      '<p><b>Input suitability:</b> ' + U.escapeHtml(e.suitabilityLabel || '—') + '</p>' + (e.warnings && e.warnings.length ? '<ul>' + e.warnings.map(function (w) { return '<li>' + U.escapeHtml(w) + '</li>'; }).join('') + '</ul>' : '') + '</div></div></div>' +
      '<div class="table-wrap"><table class="table"><thead><tr><th>Region</th><th>Location (x, y)</th><th class="num">Area (px)</th><th class="num">% of image</th><th class="num">Score</th><th>Classification</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<h3 style="margin:18px 0 6px">Analysis summary</h3><div class="summary-text"><p>' + U.escapeHtml(e.summary || '') + '</p></div>';
    var body = U.openModal(e.filename, html);
    WS.Charts.doughnut(body.querySelector('#mDonut'), CI.map(function (c) { return { label: c.name, value: e.counts[c.id], color: c.hex }; }), { centerMain: e.percentages[0].toFixed(1) + '%', centerSub: 'suspected waste', fmt: function (v, p) { return U.fmtInt(v) + ' px (' + p.toFixed(2) + '%)'; } });
  }

  function init() {
    load();
    $('#historyList').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-act]'); if (!btn) return;
      var id = btn.closest('.history-card').getAttribute('data-id');
      if (btn.getAttribute('data-act') === 'view') view(id); else remove(id);
    });
    $('#clearHistoryBtn').addEventListener('click', function () {
      if (entries.length && window.confirm('Delete all ' + entries.length + ' saved analyses from this browser? This cannot be undone.')) clear();
    });
    WS.bus.on('analysis:done', function (a) { if (!a.live) add(a); });
    WS.bus.on('history:changed', render);
    window.addEventListener('storage', function (e) { if (e.key === KEY) { load(); render(); WS.bus.emit('history:changed'); } });
    render();
  }

  WS.History = { init: init, all: all, add: add, remove: remove, clear: clear, view: view };
})();

/*
 * WasteScan – results.js : renders the results dashboard (warnings, statistic cards, charts, region table, summary)
 * and builds the plain-text analysis summary that is reused by the history and the report.
 */
(function () {
  'use strict';
  var WS = window.WS = window.WS || {};
  var U = WS.U, $ = U.$;

  var CARD_ICONS = ['pin', 'chart', 'layers', 'area', 'image'];

  /** Area of a region in ORIGINAL-image pixels / hectares (if a ground resolution was given). */
  function regionGround(analysis, r) {
    var sc = analysis.prep.scale || 1;
    var px = r.area / (sc * sc);
    var gsd = analysis.settings.gsd;
    return { originalPx: px, ha: gsd > 0 ? U.hectares(px, gsd) : 0 };
  }

  /** Priority counts for an arbitrary list of regions. */
  function priorityCounts(regions) {
    var c = { High: 0, Medium: 0, Low: 0 };
    regions.forEach(function (r) { c[r.priority]++; });
    return c;
  }

  /** Human-readable summary of an analysis. Returns {text, parts[]}. */
  function summaryParts(a) {
    var r = a.result, CI = WS.Classifier.CLASS_INFO, parts = [];
    var n = r.regions.length;
    var head = 'Heuristic RGB image analysis of “' + a.filename + '” (' + a.originalWidth + '×' + a.originalHeight + ' px, analysed at ' + r.width + '×' + r.height + ' px) ';
    if (n) head += 'flagged ' + n + ' candidate waste region' + (n === 1 ? '' : 's') + ' covering ' + r.wastePct.toFixed(2) + '% of the analysed image (' + U.fmtInt(r.counts[0]) + ' pixels).';
    else head += 'found no candidate waste regions with the current settings.';
    parts.push(head);
    var order = [1, 2, 3, 4].sort(function (x, y) { return r.percentages[y] - r.percentages[x]; });
    parts.push('Land cover: ' + order.map(function (k) { return CI[k].name + ' ' + r.percentages[k].toFixed(1) + '%'; }).join(', ') + '. The dominant class is ' + CI[order[0]].name + '.');
    if (n) {
      var big = r.regions[0], pc = priorityCounts(r.regions);
      parts.push('The largest candidate (R' + big.id + ') covers ' + U.fmtInt(big.area) + ' px (' + big.pct.toFixed(2) + '% of the image) with a detection score of ' + big.score + ' (' + big.priority + ' priority). Priorities: ' +
        pc.High + ' High, ' + pc.Medium + ' Medium, ' + pc.Low + ' Low. Priority reflects the heuristic score only.');
    }
    var s = a.settings;
    parts.push('Settings: sensitivity ' + s.sensitivity + ' (score threshold ' + r.threshold.toFixed(2) + '), colour-variation threshold ' + s.colourVariation + ', minimum region ' + (+s.minRegionPct).toFixed(2) + '% of the image, resolution ' + s.resolution + '. Input suitability: ' + r.suitabilityLabel + (r.warnings.length ? ' (' + r.warnings.length + ' warning' + (r.warnings.length === 1 ? '' : 's') + ')' : '') + '.');
    parts.push('These are heuristic image-processing estimates, not verified detections or predictions of a trained model. Every candidate area must be checked by a person (for example by a field inspection) before any conclusion is drawn.');
    return { text: parts.join(' '), parts: parts };
  }
  function buildSummary(a) { return summaryParts(a).text; }

  function statCard(icon, cls, label, value, sub, extra) {
    return '<article class="stat-card ' + (extra || '') + '"><div class="stat-icon ' + cls + '">' + U.icon(icon) + '</div><div class="stat-body"><span class="stat-label">' + label +
      '</span><strong class="stat-value">' + value + '</strong><small class="stat-sub">' + sub + '</small></div></article>';
  }

  function render(a) {
    var r = a.result, CI = WS.Classifier.CLASS_INFO, n = r.pixels;
    $('#resultsEmpty').hidden = true; $('#resultsBody').hidden = false;
    $('#resTitle').textContent = a.filename;
    $('#resMeta').textContent = U.fmtDate(a.date) + ' · ' + a.originalWidth + '×' + a.originalHeight + ' px · analysed at ' + r.width + '×' + r.height + ' px · ' + (a.elapsedMs / 1000).toFixed(2) + ' s' + (a.usedWorker ? ' (background worker)' : ' (main thread)');

    // reliability warnings
    var ws = $('#resWarnings');
    ws.innerHTML = r.warnings.map(function (w) {
      return '<div class="alert ' + (w.level === 'warn' ? 'alert-warn' : 'alert-info') + '">' + U.icon(w.level === 'warn' ? 'alert' : 'info') + '<span>' + U.escapeHtml(w.message) + '</span></div>';
    }).join('');

    // statistic cards
    var cards = [
      statCard('image', 'c-green', 'Total pixels analysed', U.fmtInt(n), r.width + ' × ' + r.height + ' px'),
      statCard('pin', 'c-red', 'Suspected waste pixels', U.fmtInt(r.counts[0]), r.percentages[0].toFixed(2) + '% of image', 'is-waste'),
      statCard('chart', 'c-red', 'Suspected waste coverage', r.wastePct.toFixed(2) + '%', 'heuristic estimate', 'is-waste'),
      statCard('layers', 'c-amber', 'Connected suspected regions', U.fmtInt(r.regions.length), r.discardedRegions + ' smaller / thread-like candidate(s) discarded'),
      statCard('layers', 'c-green', 'Vegetation pixels', U.fmtInt(r.counts[1]), r.percentages[1].toFixed(1) + '%'),
      statCard('area', 'c-grey', 'Built-up pixels', U.fmtInt(r.counts[2]), r.percentages[2].toFixed(1) + '%'),
      statCard('area', 'c-blue', 'Water body pixels', U.fmtInt(r.counts[3]), r.percentages[3].toFixed(1) + '%'),
      statCard('area', 'c-yellow', 'Barren land pixels', U.fmtInt(r.counts[4]), r.percentages[4].toFixed(1) + '%')
    ];
    $('#resCards').innerHTML = cards.join('');

    // charts
    WS.Charts.doughnut($('#chartDonut'), CI.map(function (c) { return { label: c.name, value: r.counts[c.id], color: c.hex }; }), {
      centerMain: r.percentages[0].toFixed(1) + '%', centerSub: 'suspected waste',
      fmt: function (v, p) { return U.fmtInt(v) + ' px (' + p.toFixed(2) + '%)'; }, aria: 'Land-cover distribution'
    });
    WS.Charts.bars($('#chartBar'), CI.map(function (c) { return { label: c.short.replace('Suspected Waste', 'Waste'), value: r.percentages[c.id], color: c.hex, px: r.counts[c.id] }; }), {
      fmt: function (v) { return v.toFixed(1) + '%'; }, axisFmt: function (v) { return Math.round(v) + '%'; }, allowZero: true,
      tipFmt: function (it) { return it.value.toFixed(2) + '% · ' + U.fmtInt(it.px) + ' px'; }, aria: 'Land-cover categories compared'
    });

    // regions table
    var tb = $('#regionsBody'), gsd = a.settings.gsd;
    $('#regionsCount').textContent = r.regions.length + ' region' + (r.regions.length === 1 ? '' : 's') + ' · click a row to zoom to it';
    if (!r.regions.length) {
      tb.innerHTML = '<tr class="empty-row"><td colspan="6">No candidate waste regions were detected with the current settings.</td></tr>';
    } else {
      var sc = a.prep.scale || 1;
      tb.innerHTML = r.regions.map(function (g) {
        var gr = regionGround(a, g);
        return '<tr data-region="' + g.id + '" style="cursor:pointer" title="Zoom to this region">' +
          '<td><b>R' + g.id + '</b></td>' +
          '<td>' + Math.round(g.cx / sc) + ', ' + Math.round(g.cy / sc) + '</td>' +
          '<td class="num">' + U.fmtInt(g.area) + (gsd > 0 ? '<br><small class="muted">≈ ' + U.fmtHa(gr.ha) + '</small>' : '') + '</td>' +
          '<td class="num">' + g.pct.toFixed(2) + '%</td>' +
          '<td class="num">' + g.score + ' / 100</td>' +
          '<td><span class="pill pill-' + g.priority.toLowerCase() + '">' + g.priority + ' Priority</span></td></tr>';
      }).join('');
    }

    // summary
    var sp = summaryParts(a);
    $('#resSummary').innerHTML = sp.parts.map(function (t) { return '<p>' + U.escapeHtml(t) + '</p>'; }).join('');

    WS.Viewer.setAnalysis(a);
  }

  function showEmpty() {
    $('#resultsEmpty').hidden = false; $('#resultsBody').hidden = true;
    if (WS.Viewer) WS.Viewer.clear();
  }

  function init() {
    WS.bus.on('analysis:done', render);
    WS.bus.on('analysis:cleared', showEmpty);
    $('#regionsBody').addEventListener('click', function (e) {
      var tr = e.target.closest('[data-region]');
      if (tr) WS.Viewer.focusRegion(+tr.getAttribute('data-region'));
    });
    showEmpty();
  }

  WS.Results = { init: init, render: render, buildSummary: buildSummary, summaryParts: summaryParts, priorityCounts: priorityCounts, regionGround: regionGround };
})();

/*
 * WasteScan – report.js : report preview + local file generation.
 *   - Download PDF Report  (own PDF writer, js/pdf.js – no external service)
 *   - Download CSV Results (UTF-8 with BOM so Excel opens it correctly)
 *   - Download Detection Image (PNG with legend strip)
 *   - Print (print-ready layout of the preview; "Save as PDF" is also possible from the print dialog)
 */
(function () {
  'use strict';
  var WS = window.WS = window.WS || {};
  var U = WS.U, $ = U.$;

  var cache = { id: null, orig: null, overlay: null, ow: 0, oh: 0 };

  var DISCLAIMER = 'This report contains heuristic image-processing estimates based on RGB colour and texture rules. It is not produced by a trained or scientifically validated model. ' +
    'Highlighted areas are candidates only – they are not confirmed illegal waste dumping and must be verified by a person (for example through a field inspection).';

  /* ---------------------------------------------------------------- data model */
  function model(a) {
    var r = a.result, pc = WS.Results.priorityCounts(r.regions);
    var sc = a.prep.scale || 1;
    return {
      a: a, r: r, CI: WS.Classifier.CLASS_INFO, pc: pc, sc: sc,
      filename: a.filename, date: new Date(a.date),
      origText: a.originalWidth + ' × ' + a.originalHeight + ' px', anText: r.width + ' × ' + r.height + ' px',
      origPixels: a.originalWidth * a.originalHeight,
      gsd: a.settings.gsd || 0,
      parts: WS.Results.summaryParts(a).parts
    };
  }
  function dateText(d) { return d.toLocaleString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  function settingsText(a) {
    var s = a.settings;
    return 'Sensitivity ' + s.sensitivity + ' · colour variation ' + s.colourVariation + ' · min. region ' + (+s.minRegionPct).toFixed(2) + '% · resolution ' + s.resolution;
  }
  function priorityText(pc) { return pc.High + ' High / ' + pc.Medium + ' Medium / ' + pc.Low + ' Low'; }

  function images(a) {
    if (cache.id === a.id && cache.orig) return cache;
    var o = WS.Viewer.exportCanvas('original', 900), d = WS.Viewer.exportCanvas('overlay', 900, { labels: true });
    cache = { id: a.id, orig: o.toDataURL('image/jpeg', 0.86), overlay: d.toDataURL('image/jpeg', 0.86), ow: o.width, oh: o.height };
    return cache;
  }

  /* ---------------------------------------------------------------- HTML preview (also the print layout) */
  function previewHTML(m) {
    var r = m.r, a = m.a, img = images(a), E = U.escapeHtml;
    var distRows = m.CI.map(function (c) {
      return '<tr><td><i class="rp-sw" style="background:' + c.hex + '"></i>' + (c.id === 0 ? 'Suspected Waste Dumping' : c.name) + '</td><td class="r">' + U.fmtInt(r.counts[c.id]) + '</td><td class="r">' + r.percentages[c.id].toFixed(2) + '%</td>' +
        '<td><div class="rp-bar"><i style="width:' + Math.max(0.5, r.percentages[c.id]) + '%;background:' + c.hex + '"></i></div></td></tr>';
    }).join('');
    var shown = r.regions.slice(0, 25);
    var regRows = shown.length ? shown.map(function (g) {
      return '<tr><td><b>R' + g.id + '</b></td><td>' + Math.round(g.cx / m.sc) + ', ' + Math.round(g.cy / m.sc) + '</td><td class="r">' + U.fmtInt(g.area) + '</td><td class="r">' + g.pct.toFixed(2) + '%</td><td class="r">' + g.score + '</td><td><span class="pill pill-' + g.priority.toLowerCase() + '">' + g.priority + ' Priority</span></td></tr>';
    }).join('') : '<tr><td colspan="6" style="text-align:center;color:#5c6b63">No candidate regions detected with the current settings.</td></tr>';
    var more = r.regions.length > shown.length ? '<p style="font-size:11.5px;color:#5c6b63;margin:6px 0 0">+ ' + (r.regions.length - shown.length) + ' more region(s) are listed in the CSV file.</p>' : '';
    var warn = r.warnings.length ? '<h2>Reliability warnings</h2><ul style="margin:0;padding-left:18px">' + r.warnings.map(function (w) { return '<li>' + E(w.message) + '</li>'; }).join('') + '</ul>' : '';
    var meta = [
      ['Image filename', E(m.filename)], ['Analysis date &amp; time', E(dateText(m.date))], ['Image resolution', m.origText], ['Analysed at', m.anText],
      ['File size', U.fmtBytes(a.fileSize || 0)], ['Total pixels analysed', U.fmtInt(r.pixels)], ['Detection settings', E(settingsText(a))],
      ['Processing time', (a.elapsedMs / 1000).toFixed(2) + ' s'], ['Ground resolution', m.gsd > 0 ? m.gsd + ' m/pixel (≈ ' + U.fmtHa(U.hectares(m.origPixels, m.gsd)) + ')' : 'not specified'], ['Input suitability', r.suitabilityLabel]
    ].map(function (x) { return '<div><dt>' + x[0] + '</dt><dd>' + x[1] + '</dd></div>'; }).join('');
    return '<div class="rp-head"><div><h1>WasteScan – Analysis Report</h1><small>Identification of Illegal Waste Dumping Sites Using Aerial Image Analysis</small></div><img src="assets/logo.svg" alt=""></div>' +
      '<dl class="rp-meta">' + meta + '</dl>' +
      '<div class="rp-kpis"><div class="rp-kpi red"><span>Suspected waste coverage</span><b>' + r.wastePct.toFixed(2) + '%</b></div><div class="rp-kpi"><span>Candidate regions</span><b>' + r.regions.length + '</b></div>' +
      '<div class="rp-kpi"><span>Priority (H / M / L)</span><b>' + m.pc.High + ' / ' + m.pc.Medium + ' / ' + m.pc.Low + '</b></div><div class="rp-kpi"><span>Input suitability</span><b>' + r.suitabilityLabel + '</b></div></div>' +
      '<h2>Land-cover distribution</h2><table class="rp-table"><thead><tr><th>Class</th><th class="r">Pixels</th><th class="r">Share</th><th style="width:30%"></th></tr></thead><tbody>' + distRows + '</tbody></table>' +
      '<h2>Original image and detection overlay</h2><div class="rp-images"><figure><img alt="Original uploaded image" src="' + img.orig + '"><figcaption>Original uploaded image</figcaption></figure>' +
      '<figure><img alt="Detection overlay" src="' + img.overlay + '"><figcaption>Detection overlay – red = suspected waste dumping (heuristic)</figcaption></figure></div>' +
      '<h2>Detected candidate regions</h2><table class="rp-table"><thead><tr><th>Region</th><th>Location (x, y)</th><th class="r">Area (px)</th><th class="r">% of image</th><th class="r">Score</th><th>Classification</th></tr></thead><tbody>' + regRows + '</tbody></table>' + more +
      '<h2>Analysis summary</h2>' + m.parts.map(function (t) { return '<p>' + E(t) + '</p>'; }).join('') + warn +
      '<div class="rp-note"><b>Important:</b> ' + E(DISCLAIMER) + '</div>' +
      '<div class="rp-foot"><span>WasteScan · Detect. Analyse. Protect.</span><span>Generated locally in the browser · no data uploaded</span></div>';
  }

  /* ---------------------------------------------------------------- CSV */
  function csvCell(v) { var s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function csvRow(arr) { return arr.map(csvCell).join(','); }

  function buildCSV(m) {
    var a = m.a, r = m.r, s = a.settings, L = [];
    L.push(csvRow(['WasteScan analysis results']));
    L.push(csvRow(['Note', 'Heuristic image-processing estimates – not verified detections. Human verification required.']));
    L.push('');
    L.push(csvRow(['Field', 'Value']));
    [['Image filename', m.filename], ['Analysis date/time', m.date.toISOString()], ['Original resolution (px)', a.originalWidth + 'x' + a.originalHeight], ['Analysed resolution (px)', r.width + 'x' + r.height],
      ['File size (bytes)', a.fileSize], ['Total pixels analysed', r.pixels], ['Suspected waste coverage (%)', r.wastePct.toFixed(4)], ['Candidate regions', r.regions.length],
      ['Priority High', m.pc.High], ['Priority Medium', m.pc.Medium], ['Priority Low', m.pc.Low],
      ['Sensitivity', s.sensitivity], ['Score threshold', r.threshold.toFixed(3)], ['Colour variation threshold', s.colourVariation], ['Minimum region size (% of image)', s.minRegionPct],
      ['Analysis resolution', s.resolution], ['Ground resolution (m/pixel)', s.gsd > 0 ? s.gsd : 'not specified'], ['Input suitability', r.suitabilityLabel]
    ].forEach(function (x) { L.push(csvRow(x)); });
    L.push(''); L.push(csvRow(['Land-cover distribution']));
    L.push(csvRow(['Class', 'Pixels', 'Percentage (%)']));
    m.CI.forEach(function (c) { L.push(csvRow([c.id === 0 ? 'Suspected Waste Dumping' : c.name, r.counts[c.id], r.percentages[c.id].toFixed(4)])); });
    L.push(''); L.push(csvRow(['Suspected waste regions (candidates only)']));
    L.push(csvRow(['Region ID', 'Centroid X (original px)', 'Centroid Y (original px)', 'Area (analysis px)', 'Percentage of image (%)', 'Approx. area (original px)', 'Approx. area (hectares)', 'Detection score (0-100)', 'Classification', 'Bounding box x0,y0,x1,y1 (analysis px)']));
    r.regions.forEach(function (g) {
      var gr = WS.Results.regionGround(a, g);
      L.push(csvRow(['R' + g.id, Math.round(g.cx / m.sc), Math.round(g.cy / m.sc), g.area, g.pct.toFixed(4), Math.round(gr.originalPx), gr.ha ? gr.ha.toFixed(4) : '', g.score, g.priority + ' Priority', [g.x0, g.y0, g.x1, g.y1].join(' ')]));
    });
    if (r.warnings.length) { L.push(''); L.push(csvRow(['Warnings'])); r.warnings.forEach(function (w) { L.push(csvRow([w.level, w.message])); }); }
    return '﻿' + L.join('\r\n') + '\r\n';
  }

  /* ---------------------------------------------------------------- PDF */
  function buildPDF(m) {
    var a = m.a, r = m.r, img = images(a);
    var doc = new WS.PDF.Doc({ title: 'WasteScan analysis report – ' + m.filename });
    var M = 42, CW = doc.W - 2 * M, LIM = doc.H - 54, y;
    var DARK = [14, 46, 34], GREEN = [31, 122, 77], GREY = [92, 107, 99], INK = [23, 35, 29];

    function header() {
      doc.rect(0, 0, doc.W, 92, { fill: [14, 46, 34] });
      doc.rect(M, 24, 44, 44, { fill: [31, 138, 86], radius: 10 });
      doc.rect(M + 12, 36, 20, 20, { stroke: [154, 240, 189], lw: 2 });
      doc.rect(M + 17, 41, 10, 10, { fill: [255, 90, 79] });
      doc.text('WasteScan – Analysis Report', M + 58, 44, { size: 19, bold: true, color: [255, 255, 255] });
      doc.text('Identification of Illegal Waste Dumping Sites Using Aerial Image Analysis', M + 58, 62, { size: 9, color: [143, 224, 181] });
      doc.text(dateText(m.date), doc.W - M, 44, { size: 8.5, color: [200, 225, 211], align: 'right' });
      doc.text('Detect. Analyse. Protect.', doc.W - M, 62, { size: 8.5, color: [143, 224, 181], align: 'right' });
    }
    function section(title) {
      ensure(40);
      doc.text(title, M, y + 12, { size: 12, bold: true, color: DARK });
      doc.line(M, y + 18, M + CW, y + 18, { color: GREEN, lw: 1.4 });
      y += 28;
    }
    function ensure(h) { if (y + h > LIM) { doc.addPage(); y = 46; } }

    doc.addPage(); header(); y = 112;

    section('Report details');
    var meta = [
      ['Image filename', m.filename], ['Analysis date & time', dateText(m.date)], ['Image resolution', m.origText], ['Analysed at', m.anText],
      ['File size', U.fmtBytes(a.fileSize || 0)], ['Total pixels analysed', U.fmtInt(r.pixels)], ['Processing time', (a.elapsedMs / 1000).toFixed(2) + ' s'],
      ['Ground resolution', m.gsd > 0 ? m.gsd + ' m/pixel' : 'not specified']
    ];
    var colW = CW / 2 - 8;
    meta.forEach(function (x, i) {
      var cx = M + (i % 2) * (colW + 16), cy = y + Math.floor(i / 2) * 26;
      doc.text(x[0].toUpperCase(), cx, cy + 8, { size: 7, color: GREY, bold: true });
      var v = x[1]; while (doc.textWidth(v, 9.5, true) > colW && v.length > 8) v = v.slice(0, -2);
      if (v !== x[1]) v += '…';
      doc.text(v, cx, cy + 20, { size: 9.5, bold: true, color: INK });
    });
    y += Math.ceil(meta.length / 2) * 26 + 4;
    doc.text('DETECTION SETTINGS', M, y + 8, { size: 7, color: GREY, bold: true });
    doc.text(settingsText(a), M, y + 20, { size: 9, color: INK });
    y += 34;

    // KPI boxes
    var kw = (CW - 30) / 4, kpis = [
      ['SUSPECTED WASTE COVERAGE', r.wastePct.toFixed(2) + '%', [211, 47, 47]], ['CANDIDATE REGIONS', String(r.regions.length), INK],
      ['PRIORITY  H / M / L', m.pc.High + ' / ' + m.pc.Medium + ' / ' + m.pc.Low, INK], ['INPUT SUITABILITY', r.suitabilityLabel, INK]
    ];
    ensure(60);
    kpis.forEach(function (k, i) {
      var x = M + i * (kw + 10);
      doc.rect(x, y, kw, 50, { fill: [246, 250, 247], stroke: [223, 231, 226], radius: 6 });
      doc.text(k[0], x + 9, y + 15, { size: 6.5, bold: true, color: GREY });
      doc.text(k[1], x + 9, y + 38, { size: 17, bold: true, color: k[2] });
    });
    y += 66;

    // land-cover distribution
    section('Land-cover distribution');
    var bx = M, bw = CW;
    m.CI.forEach(function (c) {
      var w = bw * r.percentages[c.id] / 100;
      if (w > 0.4) { doc.rect(bx, y, w, 14, { fill: c.color }); bx += w; }
    });
    y += 26;
    doc.rect(M, y, CW, 16, { fill: [234, 243, 238] });
    doc.text('CLASS', M + 8, y + 11, { size: 7.5, bold: true, color: [51, 68, 85] });
    doc.text('PIXELS', M + 250, y + 11, { size: 7.5, bold: true, color: [51, 68, 85], align: 'right' });
    doc.text('SHARE', M + 320, y + 11, { size: 7.5, bold: true, color: [51, 68, 85], align: 'right' });
    y += 16;
    m.CI.forEach(function (c) {
      doc.rect(M + 8, y + 5, 9, 9, { fill: c.color, radius: 2 });
      doc.text(c.id === 0 ? 'Suspected Waste Dumping' : c.name, M + 24, y + 13, { size: 9.5, color: INK });
      doc.text(U.fmtInt(r.counts[c.id]), M + 250, y + 13, { size: 9.5, align: 'right', color: INK });
      doc.text(r.percentages[c.id].toFixed(2) + '%', M + 320, y + 13, { size: 9.5, align: 'right', bold: true, color: INK });
      doc.rect(M + 345, y + 6, 166, 7, { fill: [230, 236, 232], radius: 3 });
      doc.rect(M + 345, y + 6, Math.max(1.5, 166 * r.percentages[c.id] / 100), 7, { fill: c.color, radius: 3 });
      doc.line(M, y + 20, M + CW, y + 20, { color: [228, 236, 231], lw: 0.5 });
      y += 21;
    });
    y += 8;

    // images
    var iw = (CW - 12) / 2, ih = iw * cache.oh / cache.ow;
    ensure(ih + 60);
    section('Original image and detection overlay');
    var n1 = doc.addJPEG(img.orig, cache.ow, cache.oh), n2 = doc.addJPEG(img.overlay, cache.ow, cache.oh);
    doc.image(n1, M, y, iw, ih); doc.image(n2, M + iw + 12, y, iw, ih);
    doc.rect(M, y, iw, ih, { stroke: [213, 223, 217], lw: 0.5 }); doc.rect(M + iw + 12, y, iw, ih, { stroke: [213, 223, 217], lw: 0.5 });
    doc.text('Original uploaded image', M + iw / 2, y + ih + 12, { size: 8, color: GREY, align: 'center' });
    doc.text('Detection overlay (red = suspected waste, heuristic)', M + iw + 12 + iw / 2, y + ih + 12, { size: 8, color: GREY, align: 'center' });
    y += ih + 26;

    // regions
    section('Detected candidate regions');
    var cols = { id: M + 8, loc: M + 54, area: M + 250, pct: M + 316, score: M + 372, cls: M + 392 };
    function regionHead() {
      doc.rect(M, y, CW, 16, { fill: [234, 243, 238] });
      var o = { size: 7.5, bold: true, color: [51, 68, 85] };
      doc.text('REGION', cols.id, y + 11, o); doc.text('LOCATION (X, Y)', cols.loc, y + 11, o);
      doc.text('AREA (PX)', cols.area, y + 11, Object.assign({ align: 'right' }, o)); doc.text('% IMAGE', cols.pct, y + 11, Object.assign({ align: 'right' }, o));
      doc.text('SCORE', cols.score, y + 11, Object.assign({ align: 'right' }, o)); doc.text('CLASSIFICATION', cols.cls, y + 11, o);
      y += 16;
    }
    regionHead();
    var PCOL = { High: [183, 28, 28], Medium: [138, 82, 0], Low: [13, 71, 161] };
    if (!r.regions.length) { doc.text('No candidate waste regions were detected with the current settings.', M + CW / 2, y + 16, { size: 9.5, color: GREY, align: 'center' }); y += 28; }
    var maxRows = 30;
    r.regions.slice(0, maxRows).forEach(function (g) {
      if (y + 20 > LIM) { doc.addPage(); y = 46; regionHead(); }
      doc.text('R' + g.id, cols.id, y + 13, { size: 9.5, bold: true, color: INK });
      doc.text(Math.round(g.cx / m.sc) + ', ' + Math.round(g.cy / m.sc), cols.loc, y + 13, { size: 9.5, color: INK });
      doc.text(U.fmtInt(g.area), cols.area, y + 13, { size: 9.5, align: 'right', color: INK });
      doc.text(g.pct.toFixed(2) + '%', cols.pct, y + 13, { size: 9.5, align: 'right', color: INK });
      doc.text(String(g.score), cols.score, y + 13, { size: 9.5, align: 'right', color: INK });
      doc.text(g.priority + ' Priority', cols.cls, y + 13, { size: 9.5, bold: true, color: PCOL[g.priority] });
      doc.line(M, y + 20, M + CW, y + 20, { color: [228, 236, 231], lw: 0.5 });
      y += 20;
    });
    if (r.regions.length > maxRows) { doc.text('+ ' + (r.regions.length - maxRows) + ' more region(s) are listed in the CSV file.', M, y + 14, { size: 8.5, color: GREY }); y += 20; }
    doc.text('Priority is based on the heuristic detection score only (High ≥ 70, Medium ≥ 58, otherwise Low) and requires human verification.', M, y + 12, { size: 8, color: GREY });
    y += 26;

    // summary
    section('Analysis summary');
    m.parts.forEach(function (t) {
      var lines = doc.wrap(t, CW, 9.5, false);
      ensure(lines.length * 13.5 + 6);
      y = doc.paragraph(t, M, y, CW, { size: 9.5, lineHeight: 13.5, color: INK }) + 5;
    });
    if (r.warnings.length) {
      section('Reliability warnings');
      r.warnings.forEach(function (w) {
        var lines = doc.wrap('• ' + w.message, CW - 8, 9, false); ensure(lines.length * 12.5 + 4);
        y = doc.paragraph('• ' + w.message, M + 4, y, CW - 8, { size: 9, lineHeight: 12.5, color: [138, 82, 0] }) + 3;
      });
    }
    var dl = doc.wrap(DISCLAIMER, CW - 24, 9, false);
    ensure(dl.length * 12.5 + 40);
    y += 6;
    doc.rect(M, y, CW, dl.length * 12.5 + 28, { fill: [255, 246, 229], stroke: [241, 212, 155], radius: 6 });
    doc.text('IMPORTANT', M + 12, y + 15, { size: 8, bold: true, color: [109, 74, 0] });
    doc.paragraph(DISCLAIMER, M + 12, y + 20, CW - 24, { size: 9, lineHeight: 12.5, color: [109, 74, 0] });

    // footers
    var total = doc.pages.length;
    for (var p = 0; p < total; p++) {
      doc.setPage(p);
      doc.line(M, doc.H - 38, M + CW, doc.H - 38, { color: [223, 231, 226] });
      doc.text('WasteScan · heuristic image-processing estimate – requires human verification · generated locally', M, doc.H - 24, { size: 7.5, color: GREY });
      doc.text('Page ' + (p + 1) + ' of ' + total, M + CW, doc.H - 24, { size: 7.5, color: GREY, align: 'right' });
    }
    return doc.save();
  }

  /* ---------------------------------------------------------------- actions */
  function current() {
    var a = WS.state.analysis;
    if (!a) { U.toast('Run an analysis first.', 'warn'); return null; }
    return a;
  }
  function fileBase(a) { return 'WasteScan_' + U.baseName(a.filename) + '_' + U.stamp(); }

  function downloadPDF() {
    var a = current(); if (!a) return;
    try { U.download(buildPDF(model(a)), fileBase(a) + '_report.pdf'); U.toast('PDF report generated.'); }
    catch (e) { console.error(e); U.toast('The PDF could not be generated: ' + e.message, 'error'); }
  }
  function downloadCSV() {
    var a = current(); if (!a) return;
    try { U.download(new Blob([buildCSV(model(a))], { type: 'text/csv;charset=utf-8' }), fileBase(a) + '_results.csv'); U.toast('CSV file generated.'); }
    catch (e) { console.error(e); U.toast('The CSV could not be generated: ' + e.message, 'error'); }
  }
  function downloadImage() {
    var a = current(); if (!a) return;
    var c = WS.Viewer.exportAnnotated();
    if (!c) { U.toast('The detection image is not available.', 'error'); return; }
    c.toBlob(function (b) { if (!b) { U.toast('The image could not be created.', 'error'); return; } U.download(b, fileBase(a) + '_detection.png'); U.toast('Detection image saved.'); }, 'image/png');
  }
  function printReport() {
    if (!current()) return;
    WS.App.navigate('report');
    setTimeout(function () { window.print(); }, 250);
  }

  function render(a) {
    $('#reportEmpty').hidden = true; $('#reportBody').hidden = false;
    $('#reportPreview').innerHTML = previewHTML(model(a));
  }
  function showEmpty() { $('#reportEmpty').hidden = false; $('#reportBody').hidden = true; $('#reportPreview').innerHTML = ''; cache = { id: null }; }

  function init() {
    $('#btnPdf').addEventListener('click', downloadPDF);
    $('#btnCsv').addEventListener('click', downloadCSV);
    $('#btnImg').addEventListener('click', downloadImage);
    $('#btnPrint').addEventListener('click', printReport);
    WS.bus.on('analysis:done', function (a) { cache = { id: null }; render(a); });
    WS.bus.on('overlay:change', function () { /* the report keeps the overlay rendered at analysis time */ });
    WS.bus.on('analysis:cleared', showEmpty);
    showEmpty();
  }

  WS.Report = { init: init, buildCSV: function (a) { return buildCSV(model(a)); }, buildPDF: function (a) { return buildPDF(model(a)); }, downloadPDF: downloadPDF, downloadCSV: downloadCSV, downloadImage: downloadImage };
})();

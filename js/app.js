/*
 * WasteScan – app.js : application shell
 *   - hash router + navigation, theme, detection settings (persisted locally)
 *   - dashboard rendering (sample vs. actual statistics)
 *   - analysis orchestration (progress UI, errors, hand-over to results/history)
 * Feature modules (upload, visualization, results, history, report) register themselves on window.WS and are
 * optional here, so this file works as the foundation for all of them.
 */
(function () {
  'use strict';
  var WS = window.WS = window.WS || {};
  var U = WS.U, $ = U.$, $$ = U.$$;

  var SETTINGS_KEY = 'wastescan.settings.v1';
  var DEFAULTS = {
    sensitivity: 50, colourVariation: 22, minRegionPct: 0.15, resolution: 'medium', gsd: 0,
    overlayOpacity: 60, showClasses: true, showLabels: true, theme: null
  };
  var PAGES = ['dashboard', 'analyse', 'results', 'report', 'history', 'how', 'method', 'about'];

  var state = WS.state = {
    loaded: null,        // decoded source image {img,url,width,height,name,size,type}
    analysis: null,      // latest completed analysis
    settings: Object.assign({}, DEFAULTS, U.store.get(SETTINGS_KEY, {})),
    busy: false,
    dashSource: null,
    settingsDirty: false
  };

  function saveSettings() { U.store.set(SETTINGS_KEY, state.settings); }

  /** The subset of settings that the analysis engine understands. */
  function engineSettings() {
    var s = state.settings;
    return { sensitivity: +s.sensitivity, colourVariation: +s.colourVariation, minRegionPct: +s.minRegionPct, resolution: s.resolution, gsd: +s.gsd || 0 };
  }

  WS.legendHTML = function (opts) {
    opts = opts || {};
    var html = WS.Classifier.CLASS_INFO.map(function (c) {
      var label = c.id === 0 ? 'Suspected Waste Dumping' : c.name;
      return '<span class="legend-item"><i style="background:' + c.hex + '"></i>' + label + '</span>';
    }).join('');
    if (opts.heat) html += '<span class="legend-item"><span class="heat-ramp"></span>Waste score: low → high</span>';
    return html;
  };

  /* ================================================================ THEME */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    state.settings.theme = t; saveSettings();
  }
  function initTheme() {
    $('#themeBtn').addEventListener('click', function () {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
  }

  /* ================================================================ ROUTER */
  var currentPage = null;
  function pageFromHash() {
    var m = /^#\/?([a-z]+)/.exec(location.hash || '');
    return m && PAGES.indexOf(m[1]) !== -1 ? m[1] : 'dashboard';
  }
  function showPage(page) {
    if (!document.getElementById('page-' + page)) page = 'dashboard';
    currentPage = page;
    $$('.page').forEach(function (p) { p.classList.toggle('active', p.id === 'page-' + page); });
    $$('.nav-item').forEach(function (a) { var on = a.getAttribute('data-nav') === page; a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.body.setAttribute('data-page', page);
    var sec = document.getElementById('page-' + page);
    $('#pageTitle').textContent = sec.getAttribute('data-title') || 'WasteScan';
    $('#pageSub').textContent = sec.getAttribute('data-sub') || '';
    document.title = (sec.getAttribute('data-title') || 'WasteScan') + ' – WasteScan';
    closeNav();
    window.scrollTo(0, 0);
    WS.bus.emit('page:show', page);
  }
  function navigate(page) {
    if (location.hash === '#/' + page) showPage(page); else location.hash = '#/' + page;
  }
  function openNav() { document.body.classList.add('nav-open'); }
  function closeNav() { document.body.classList.remove('nav-open'); }
  function initRouter() {
    window.addEventListener('hashchange', function () { showPage(pageFromHash()); });
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-goto]');
      if (t) { e.preventDefault(); navigate(t.getAttribute('data-goto')); }
    });
    $('#menuBtn').addEventListener('click', openNav);
    $('#sidebarBackdrop').addEventListener('click', closeNav);
    $('#quickUploadBtn').addEventListener('click', function () {
      navigate('analyse');
      if (WS.Upload) WS.Upload.browse();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { U.closeModal(); closeNav(); } });
    $$('[data-close-modal]').forEach(function (b) { b.addEventListener('click', U.closeModal); });
    showPage(pageFromHash());
  }

  /* ================================================================ SETTINGS PANEL */
  var ENGINE_KEYS = ['sensitivity', 'colourVariation', 'minRegionPct', 'resolution', 'gsd'];
  function markDirty() {
    if (!state.analysis) return;
    state.settingsDirty = true;
    $('#settingsNote').innerHTML = '<strong>Settings changed.</strong> Press <em>Reanalyse Image</em> to apply them to the current image.';
  }
  function clearDirty() {
    state.settingsDirty = false;
    $('#settingsNote').innerHTML = 'Changing a setting does not re-run the analysis automatically. Press <em>Reanalyse Image</em> to apply it.';
  }
  function syncSettingsUI() {
    var s = state.settings;
    $('#setSens').value = s.sensitivity; $('#setSensVal').textContent = s.sensitivity;
    $('#setCV').value = s.colourVariation; $('#setCVVal').textContent = s.colourVariation;
    $('#setMin').value = Math.round(s.minRegionPct * 100); $('#setMinVal').textContent = (+s.minRegionPct).toFixed(2) + '%';
    $('#setOpacity').value = s.overlayOpacity; $('#setOpacityVal').textContent = s.overlayOpacity + '%';
    $('#setRes').value = s.resolution;
    $('#setGsd').value = s.gsd > 0 ? s.gsd : '';
    var vo = $('#viewerOpacity'); if (vo) { vo.value = s.overlayOpacity; $('#viewerOpacityVal').textContent = s.overlayOpacity + '%'; }
    var tc = $('#toggleClasses'); if (tc) tc.checked = !!s.showClasses;
    var tl = $('#toggleLabels'); if (tl) tl.checked = !!s.showLabels;
  }
  function initSettings() {
    syncSettingsUI();
    function bind(id, key, parse, after) {
      $(id).addEventListener('input', function (e) {
        state.settings[key] = parse(e.target.value);
        saveSettings(); syncSettingsUI();
        if (ENGINE_KEYS.indexOf(key) !== -1) markDirty();
        if (after) after();
      });
    }
    bind('#setSens', 'sensitivity', Number);
    bind('#setCV', 'colourVariation', Number);
    bind('#setMin', 'minRegionPct', function (v) { return Number(v) / 100; });
    bind('#setOpacity', 'overlayOpacity', Number, function () { WS.bus.emit('overlay:change'); });
    bind('#setRes', 'resolution', String);
    bind('#setGsd', 'gsd', function (v) { var n = parseFloat(v); return n > 0 ? n : 0; });
    var vo = $('#viewerOpacity');
    if (vo) vo.addEventListener('input', function (e) { state.settings.overlayOpacity = Number(e.target.value); saveSettings(); syncSettingsUI(); WS.bus.emit('overlay:change'); });
    var tc = $('#toggleClasses'); if (tc) tc.addEventListener('change', function (e) { state.settings.showClasses = e.target.checked; saveSettings(); WS.bus.emit('overlay:change'); });
    var tl = $('#toggleLabels'); if (tl) tl.addEventListener('change', function (e) { state.settings.showLabels = e.target.checked; saveSettings(); WS.bus.emit('overlay:change'); });

    $('#resetSettingsBtn').addEventListener('click', function () {
      ENGINE_KEYS.concat(['overlayOpacity']).forEach(function (k) { state.settings[k] = DEFAULTS[k]; });
      saveSettings(); syncSettingsUI(); markDirty(); WS.bus.emit('overlay:change');
      U.toast('Detection settings restored to defaults.');
    });
    $('#reanalyseBtn').addEventListener('click', function () { runAnalysis(); });
  }

  /* ================================================================ DASHBOARD */
  function realEntries() { return WS.History ? WS.History.all() : []; }

  function dashEntries() {
    return state.dashSource === 'sample' ? WS.SampleData.generate() : realEntries();
  }

  function renderDashboard() {
    var real = realEntries();
    if (!state.dashSource) state.dashSource = real.length ? 'actual' : 'sample';
    var src = state.dashSource, entries = dashEntries();
    var isSample = src === 'sample';
    $$('#dashSourceTabs .seg-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-source') === src); b.setAttribute('aria-selected', b.getAttribute('data-source') === src); });
    $$('[data-src-badge]').forEach(function (b) { b.textContent = isSample ? 'Sample' : 'Your data'; b.className = 'badge-src ' + (isSample ? 'is-sample' : 'is-actual'); });
    var banner = $('#dashBanner');
    if (isSample) banner.innerHTML = '<strong>Sample statistics.</strong> These figures are generated locally for illustration and are <em>not</em> from real images. ' + (real.length ? '' : 'Analyse an image to see your own numbers.');
    else if (real.length) banner.innerHTML = '<strong>Your analyses.</strong> Statistics from ' + real.length + ' result' + (real.length === 1 ? '' : 's') + ' stored in this browser.';
    else banner.innerHTML = '<strong>No analyses yet.</strong> Upload an image to start – your own statistics will appear here.';

    var n = entries.length;
    var sites = 0, covSum = 0, covMax = 0, px = 0, ha = 0, haCount = 0;
    entries.forEach(function (e) {
      sites += e.regionsCount; covSum += e.wastePct; covMax = Math.max(covMax, e.wastePct);
      var p = e.width * e.height; px += p;
      if (e.gsd > 0) { ha += U.hectares(p, e.gsd); haCount++; }
    });
    $('#statImages').textContent = U.fmtInt(n);
    $('#statImagesSub').textContent = n ? 'Latest: ' + U.fmtDate(entries.reduce(function (a, e) { return e.date > a ? e.date : a; }, entries[0].date)) : 'No images analysed yet';
    $('#statSites').textContent = U.fmtInt(sites);
    $('#statSitesSub').textContent = n ? 'Candidate regions across ' + n + ' image' + (n === 1 ? '' : 's') : 'Candidate regions found';
    $('#statCoverage').textContent = n ? (covSum / n).toFixed(2) + '%' : '—';
    $('#statCoverageSub').textContent = n ? 'Highest: ' + covMax.toFixed(2) + '%' : 'Share of pixels flagged';
    if (haCount) { $('#statArea').textContent = U.fmtHa(ha); $('#statAreaSub').textContent = haCount === n ? 'From the ground resolution you entered' : haCount + ' of ' + n + ' images have a ground resolution'; }
    else { $('#statArea').textContent = n ? U.fmtMP(px) : '—'; $('#statAreaSub').textContent = n ? 'Set a ground resolution to see hectares' : 'Area in hectares or megapixels'; }

    var CI = WS.Classifier.CLASS_INFO;
    var chron = entries.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(-12);
    WS.Charts.line($('#chartTrend'), chron.map(function (e) { return { label: U.fmtDateShort(e.date), value: e.wastePct, extra: e.filename }; }), { color: '#e53935', fmt: function (v) { return v.toFixed(1) + '%'; }, emptyText: 'Run an analysis to see coverage over time.', aria: 'Suspected waste coverage per analysis' });
    var avg = [0, 0, 0, 0, 0];
    entries.forEach(function (e) { for (var i = 0; i < 5; i++) avg[i] += e.percentages[i] / n; });
    WS.Charts.doughnut($('#chartDonutDash'), CI.map(function (c, i) { return { label: c.name, value: avg[i], color: c.hex }; }), { centerMain: n ? avg[0].toFixed(1) + '%' : '', centerSub: 'avg. waste', emptyText: 'Run an analysis to see the land-cover mix.', aria: 'Average land-cover mix' });
    var pr = { High: 0, Medium: 0, Low: 0 };
    entries.forEach(function (e) { var p = e.priorities || {}; pr.High += p.High || 0; pr.Medium += p.Medium || 0; pr.Low += p.Low || 0; });
    WS.Charts.bars($('#chartBarDash'), [
      { label: 'High', value: pr.High, color: '#e53935' }, { label: 'Medium', value: pr.Medium, color: '#fb8c00' }, { label: 'Low', value: pr.Low, color: '#1e88e5' }
    ], { emptyText: 'No candidate regions recorded yet.', fmt: function (v) { return String(Math.round(v)); }, tipFmt: function (it) { return it.value + ' region(s)'; }, aria: 'Candidate regions by priority' });

    var tbody = $('#dashRecent tbody');
    var recent = entries.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 5);
    if (!recent.length) tbody.innerHTML = '<tr class="empty-row"><td colspan="5">No analyses yet.</td></tr>';
    else tbody.innerHTML = recent.map(function (e) {
      var thumb = e.thumb ? '<img alt="" src="' + e.thumb + '">' : '<img alt="" style="visibility:hidden">';
      return '<tr><td><div class="file-cell">' + thumb + '<span title="' + U.escapeHtml(e.filename) + '">' + U.escapeHtml(e.filename) + '</span></div></td>' +
        '<td>' + U.fmtDate(e.date) + '</td><td class="num">' + e.wastePct.toFixed(2) + '%</td><td class="num">' + e.regionsCount + '</td>' +
        '<td class="num">' + (e.sample ? '<span class="badge-src is-sample">Sample</span>' : '<button class="table-btn" data-view-history="' + e.id + '">View</button>') + '</td></tr>';
    }).join('');
  }

  function initDashboard() {
    $$('#dashSourceTabs .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () { state.dashSource = b.getAttribute('data-source'); renderDashboard(); });
    });
    document.addEventListener('click', function (e) {
      var v = e.target.closest('[data-view-history]');
      if (v && WS.History) WS.History.view(v.getAttribute('data-view-history'));
    });
    $('#heroSampleBtn').addEventListener('click', function () {
      navigate('analyse');
      if (WS.Upload && WS.SAMPLES && WS.SAMPLES.length) WS.Upload.loadSample(WS.SAMPLES[0].id);
    });
    WS.bus.on('history:changed', function () {
      var real = realEntries();
      if (real.length && state.dashSource === 'sample' && !state.dashTouched) state.dashSource = 'actual';
      renderDashboard(); updateNavBadges();
    });
    WS.bus.on('page:show', function (p) { if (p === 'dashboard') renderDashboard(); });
    $$('#dashSourceTabs .seg-btn').forEach(function (b) { b.addEventListener('click', function () { state.dashTouched = true; }); });
    renderDashboard();
  }

  function updateNavBadges() {
    var n = realEntries().length, c = $('#navHistoryCount');
    c.hidden = n === 0; c.textContent = n;
  }

  /* ================================================================ ANALYSIS ORCHESTRATION */
  function setProgress(f, label) {
    var pct = Math.round(U.clamp(f, 0, 1) * 100);
    $('#progressBar').style.width = pct + '%';
    $('#progressPct').textContent = pct + '%';
    $('#progressLabel').textContent = label || '';
    $('#progressTrack').setAttribute('aria-valuenow', pct);
  }
  function setBusy(b) {
    state.busy = b;
    ['analyseBtn', 'reanalyseBtn'].forEach(function (id) { var el = document.getElementById(id); if (el) el.disabled = b || !state.loaded; });
    $('#progressCard').hidden = !b;
    document.body.classList.toggle('is-busy', b);
  }
  function showUploadError(msg) {
    var e = $('#uploadError');
    if (!msg) { e.hidden = true; e.innerHTML = ''; return; }
    e.hidden = false; e.innerHTML = U.icon('alert') + '<span>' + U.escapeHtml(msg) + '</span>';
  }

  function runAnalysis() {
    if (state.busy) return;
    if (!state.loaded) { U.toast('Please upload an image first.', 'warn'); navigate('analyse'); return; }
    if (currentPage !== 'analyse') navigate('analyse');
    showUploadError('');
    setBusy(true); setProgress(0, 'Preparing…');
    var snapshot = engineSettings();
    var loaded = state.loaded;
    WS.ImageProcessor.analyse(loaded, snapshot, setProgress).then(function (out) {
      var analysis = {
        id: U.uid(), date: new Date().toISOString(),
        filename: loaded.name, fileSize: loaded.size, fileType: loaded.type,
        originalWidth: loaded.width, originalHeight: loaded.height,
        settings: snapshot, result: out.result, prep: { width: out.prep.width, height: out.prep.height, scale: out.prep.scale },
        elapsedMs: out.elapsedMs, usedWorker: out.usedWorker, source: loaded
      };
      analysis.summary = WS.Results ? WS.Results.buildSummary(analysis) : '';
      state.analysis = analysis;
      clearDirty();
      setBusy(false);
      WS.bus.emit('analysis:done', analysis);
      var n = out.result.regions.length;
      U.toast('Analysis complete: ' + n + ' candidate region' + (n === 1 ? '' : 's') + ' (' + out.result.wastePct.toFixed(2) + '% of the image).');
      document.title = '✓ Analysis complete – WasteScan';
      navigate('results');
    }).catch(function (err) {
      setBusy(false);
      if (err && err.message === 'cancelled') { U.toast('Analysis cancelled.', 'warn'); return; }
      console.error('[WasteScan] analysis failed', err);
      var msg = 'The analysis failed: ' + (err && err.message ? err.message : 'unknown error') + '. Try a smaller image or a lower analysis resolution.';
      showUploadError(msg); U.toast('Analysis failed.', 'error');
    });
  }

  function resetAnalysis() {
    if (state.busy) return;
    state.analysis = null;
    WS.bus.emit('analysis:cleared');
    U.toast('Analysis reset. Your image is still loaded.');
  }

  function initAnalysis() {
    $('#analyseBtn').addEventListener('click', runAnalysis);
    $('#cancelBtn').addEventListener('click', function () { WS.ImageProcessor.cancel(); });
    var rb = $('#resetAnalysisBtn'); if (rb) rb.addEventListener('click', resetAnalysis);
    WS.bus.on('image:loaded', function () { setBusy(false); showUploadError(''); });
    WS.bus.on('image:removed', function () { setBusy(false); });
    WS.bus.on('analysis:done', function () { $('#navResultsDot').hidden = false; });
    WS.bus.on('analysis:cleared', function () { $('#navResultsDot').hidden = true; clearDirty(); });
  }

  /* ================================================================ BOOT */
  function boot() {
    initTheme();
    initSettings();
    initDashboard();
    initAnalysis();
    initRouter();
    updateNavBadges();
    $$('[data-legend-static]').forEach(function (el) { el.innerHTML = WS.legendHTML(); });
    if (WS.Upload) WS.Upload.init();
    if (WS.Viewer) WS.Viewer.init();
    if (WS.Results) WS.Results.init();
    if (WS.History) WS.History.init();
    if (WS.Report) WS.Report.init();
    renderDashboard(); updateNavBadges();
    window.addEventListener('error', function (e) { console.error(e.error || e.message); });
    window.addEventListener('unhandledrejection', function (e) { console.error(e.reason); });
  }

  WS.App = { navigate: navigate, runAnalysis: runAnalysis, resetAnalysis: resetAnalysis, getSettings: function () { return state.settings; }, engineSettings: engineSettings, showUploadError: showUploadError };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

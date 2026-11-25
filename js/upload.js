/*
 * WasteScan – upload.js : drag-and-drop / browse upload, preview, replace / remove, bundled demo images.
 * Files are only ever read by the browser (Blob URLs); nothing is transmitted.
 */
(function () {
  'use strict';
  var WS = window.WS = window.WS || {};
  var U = WS.U, $ = U.$;
  var busyLoading = false;

  function state() { return WS.state; }

  function setAnalysisSizeText() {
    var el = $('#fileAnalysisRes'), L = state().loaded;
    if (!L) { el.textContent = '—'; return; }
    var target = WS.Detection.RESOLUTIONS[state().settings.resolution] || 800;
    var sc = Math.min(1, target / Math.max(L.width, L.height));
    el.textContent = Math.round(L.width * sc) + ' × ' + Math.round(L.height * sc) + ' px';
  }

  function showPreview() {
    var L = state().loaded;
    $('#uploadEmpty').hidden = !!L;
    $('#uploadPreview').hidden = !L;
    $('#dropzone').classList.toggle('has-file', !!L);
    $('#analyseBtn').disabled = !L || state().busy;
    $('#reanalyseBtn').disabled = !L || state().busy;
    if (!L) { $('#analyseHint').textContent = 'Upload an image to enable analysis.'; return; }
    $('#previewImg').src = L.url;
    $('#fileName').textContent = L.name + (L.sample ? '  (demo image)' : '');
    $('#fileRes').textContent = L.width + ' × ' + L.height + ' px  (' + U.fmtMP(L.width * L.height) + ')';
    $('#fileSize').textContent = U.fmtBytes(L.size);
    $('#fileType').textContent = L.type || '—';
    setAnalysisSizeText();
    $('#analyseHint').textContent = L.sample
      ? 'Synthetic demonstration image – not real satellite imagery. Press Analyse Image to run the analysis.'
      : 'Ready. Press Analyse Image to run the analysis on this device.';
  }

  function release(L) { if (L && L.revoke) { try { URL.revokeObjectURL(L.url); } catch (e) {} } }

  function setLoaded(info) {
    release(state().loaded);
    state().loaded = info;
    WS.App.showUploadError('');
    showPreview();
    WS.bus.emit('image:loaded', info);
  }

  function fail(msg) {
    WS.App.showUploadError(msg);
    U.toast(msg, 'error');
  }

  /** Validate, decode and show a user-supplied File. */
  function loadFile(file) {
    if (busyLoading || state().busy) return;
    var v = WS.ImageProcessor.validateFile(file);
    if (!v.ok) { fail(v.error); return; }
    busyLoading = true;
    $('#analyseHint').textContent = 'Reading image…';
    WS.ImageProcessor.loadImage(file, file.name).then(function (res) {
      busyLoading = false;
      var type = file.type || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })[(file.name.split('.').pop() || '').toLowerCase()] || '';
      setLoaded({ img: res.img, url: res.url, revoke: res.revoke, width: res.width, height: res.height, name: file.name, size: file.size, type: type });
      U.toast('Image loaded: ' + file.name);
    }).catch(function (err) {
      busyLoading = false; showPreview();
      fail(err.message);
    });
  }

  function loadSample(id) {
    if (busyLoading || state().busy) return;
    var s = (WS.SAMPLES || []).filter(function (x) { return x.id === id; })[0];
    if (!s) { fail('The demonstration image is not available.'); return; }
    busyLoading = true;
    WS.ImageProcessor.loadImage(s.dataUrl, s.file).then(function (res) {
      busyLoading = false;
      setLoaded({ img: res.img, url: s.dataUrl, revoke: false, width: res.width, height: res.height, name: s.file, size: Math.round(s.dataUrl.length * 0.75), type: 'image/png', sample: true });
      U.toast('Demonstration image loaded. Press “Analyse Image” to run the analysis.');
    }).catch(function (err) { busyLoading = false; fail(err.message); });
  }

  function remove() {
    if (state().busy) return;
    release(state().loaded);
    state().loaded = null;
    $('#previewImg').removeAttribute('src');
    $('#fileInput').value = '';
    showPreview();
    WS.App.showUploadError('');
    WS.bus.emit('image:removed');
  }

  function browse() { var f = $('#fileInput'); f.value = ''; f.click(); }

  function renderSamples() {
    var box = $('#sampleList');
    var list = WS.SAMPLES || [];
    if (!list.length) { box.innerHTML = '<p class="muted">No demonstration images are bundled in this build.</p>'; return; }
    box.innerHTML = list.map(function (s) {
      return '<div class="sample-card"><img alt="Preview of ' + U.escapeHtml(s.title) + '" src="' + s.dataUrl + '"><div>' +
        '<strong>' + U.escapeHtml(s.title) + '</strong><small>' + U.escapeHtml(s.description) + ' (' + s.width + '×' + s.height + ' px)</small>' +
        '<button class="btn btn-outline" data-sample="' + s.id + '">' + U.icon('image') + 'Use this image</button></div></div>';
    }).join('');
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sample]');
      if (b) loadSample(b.getAttribute('data-sample'));
    });
  }

  function init() {
    var dz = $('#dropzone'), input = $('#fileInput');
    $('#browseBtn').addEventListener('click', function (e) { e.stopPropagation(); browse(); });
    $('#replaceBtn').addEventListener('click', function (e) { e.stopPropagation(); browse(); });
    $('#removeBtn').addEventListener('click', function (e) { e.stopPropagation(); remove(); });
    dz.addEventListener('click', function () { if (!state().loaded) browse(); });
    dz.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && !state().loaded) { e.preventDefault(); browse(); } });
    input.addEventListener('change', function () { if (input.files && input.files[0]) loadFile(input.files[0]); });

    var depth = 0;
    dz.addEventListener('dragenter', function (e) { e.preventDefault(); depth++; dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', function () { depth = Math.max(0, depth - 1); if (!depth) dz.classList.remove('dragover'); });
    dz.addEventListener('dragover', function (e) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
    dz.addEventListener('drop', function (e) {
      e.preventDefault(); depth = 0; dz.classList.remove('dragover');
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) { fail('No file was received. Please drop an image file.'); return; }
      if (files.length > 1) U.toast('Only one image can be analysed at a time – using “' + files[0].name + '”.', 'warn');
      loadFile(files[0]);
    });
    // a file dropped outside the drop-zone must not navigate the browser away from the app
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });

    $('#setRes').addEventListener('change', setAnalysisSizeText);
    renderSamples();
    showPreview();
    WS.bus.on('analysis:done', showPreview);
  }

  WS.Upload = { init: init, browse: browse, loadFile: loadFile, loadSample: loadSample, remove: remove };
})();

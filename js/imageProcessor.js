/*
 * WasteScan – imageProcessor.js
 * -----------------------------------------------------------------------------
 * Main-thread side of the analysis engine:
 *   - validates and decodes the uploaded file (never leaves the browser),
 *   - resizes it (aspect ratio preserved) and extracts the RGBA pixel data,
 *   - runs the pipeline from detection.js inside a Web Worker so the UI stays
 *     responsive, with an automatic chunked main-thread fallback.
 *
 * The worker is built from an in-memory Blob (the factory functions of
 * classifier.js / detection.js are serialised), so it also works when
 * index.html is opened straight from disk (file://), where external worker
 * scripts are blocked by browsers.
 */
(function () {
  'use strict';
  var WS = window.WS = window.WS || {};

  var ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
  var ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp'];
  var MAX_BYTES = 80 * 1024 * 1024;
  var MAX_PIXELS = 160e6;
  var MIN_SIDE = 64;

  var currentWorker = null;
  var currentReject = null;
  var cancelled = false;

  function ext(name) { var m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }

  /** @returns {{ok:boolean,error?:string}} */
  function validateFile(file) {
    if (!file) return { ok: false, error: 'No file was selected.' };
    var e = ext(file.name);
    var typeOk = ALLOWED_MIME.indexOf(file.type) !== -1;
    var extOk = ALLOWED_EXT.indexOf(e) !== -1;
    if (!typeOk && !(file.type === '' && extOk)) {
      return { ok: false, error: '"' + file.name + '" is not a supported image. Please upload a JPG, JPEG, PNG or WEBP file.' };
    }
    if (file.size === 0) return { ok: false, error: '"' + file.name + '" is empty (0 bytes).' };
    if (file.size > MAX_BYTES) return { ok: false, error: 'The file is larger than ' + (MAX_BYTES / 1048576) + ' MB. Please use a smaller image or export a lower-resolution copy.' };
    return { ok: true };
  }

  /** Decode an image File/Blob (or a data-URL string) into an HTMLImageElement. */
  function loadImage(source, nameForErrors) {
    return new Promise(function (resolve, reject) {
      var url = typeof source === 'string' ? source : URL.createObjectURL(source);
      var revoke = typeof source !== 'string';
      var img = new Image();
      img.onload = function () {
        if (!img.naturalWidth || !img.naturalHeight) { fail('The image has no readable pixels.'); return; }
        if (Math.min(img.naturalWidth, img.naturalHeight) < MIN_SIDE) { fail('The image is too small (' + img.naturalWidth + '×' + img.naturalHeight + ' px). At least ' + MIN_SIDE + ' px on each side is required.'); return; }
        if (img.naturalWidth * img.naturalHeight > MAX_PIXELS) { fail('The image has more than ' + (MAX_PIXELS / 1e6) + ' megapixels, which is too large for the browser to process safely.'); return; }
        resolve({ img: img, url: url, revoke: revoke, width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = function () { fail('"' + (nameForErrors || 'The file') + '" could not be decoded. The file may be corrupted or is not a valid image.'); };
      function fail(msg) { if (revoke) URL.revokeObjectURL(url); reject(new Error(msg)); }
      img.src = url;
    });
  }

  /** Resize to the analysis resolution and read the RGBA pixels. */
  function prepare(img, resolutionKey) {
    var target = WS.Detection.RESOLUTIONS[resolutionKey] || WS.Detection.RESOLUTIONS.medium;
    var nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height;
    var scale = Math.min(1, target / Math.max(nw, nh));
    var w = Math.max(1, Math.round(nw * scale)), h = Math.max(1, Math.round(nh * scale));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    // composite transparent PNG/WEBP over white so alpha does not read as black
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    var data;
    try { data = ctx.getImageData(0, 0, w, h); }
    catch (err) { throw new Error('The browser blocked pixel access to this image (' + err.message + ').'); }
    return { rgba: data.data, width: w, height: h, scale: scale, canvas: c };
  }

  function workerSource() {
    var src = 'var WS = {};\n';
    WS._factories.forEach(function (f) { src += '(' + f.toString() + ')(WS);\n'; });
    src += [
      'self.onmessage = function (e) {',
      '  var m = e.data;',
      '  try {',
      '    var rgba = new Uint8ClampedArray(m.buffer);',
      '    var job = WS.Detection.createJob(rgba, m.width, m.height, m.settings);',
      '    var total = 0, i; for (i = 0; i < job.steps.length; i++) total += job.steps[i].weight;',
      '    var done = 0;',
      '    for (i = 0; i < job.steps.length; i++) {',
      '      var st = job.steps[i];',
      '      self.postMessage({ type: "progress", fraction: done / total, label: st.label });',
      '      var t0 = Date.now(); st.run(); job.ctx.timings[st.label] = Date.now() - t0;',
      '      done += st.weight;',
      '    }',
      '    var res = job.finish(); res.timings = job.ctx.timings;',
      '    self.postMessage({ type: "done", result: res }, [res.labels.buffer, res.score8.buffer, res.regionMap.buffer]);',
      '  } catch (err) { self.postMessage({ type: "error", message: String(err && err.message || err) }); }',
      '};'
    ].join('\n');
    return src;
  }

  function runInWorker(prep, settings, onProgress) {
    return new Promise(function (resolve, reject) {
      var blobUrl, worker;
      try {
        blobUrl = URL.createObjectURL(new Blob([workerSource()], { type: 'application/javascript' }));
        worker = new Worker(blobUrl);
      } catch (e) { reject({ fallback: true, error: e }); return; }
      currentWorker = worker; currentReject = reject;
      var settled = false;
      function cleanup() { URL.revokeObjectURL(blobUrl); if (currentWorker === worker) currentWorker = null; worker.terminate(); }
      worker.onmessage = function (e) {
        var m = e.data;
        if (m.type === 'progress') onProgress && onProgress(m.fraction, m.label);
        else if (m.type === 'done') { settled = true; cleanup(); resolve(m.result); }
        else if (m.type === 'error') { settled = true; cleanup(); reject(new Error(m.message)); }
      };
      worker.onerror = function (ev) { if (settled) return; settled = true; cleanup(); reject({ fallback: true, error: new Error(ev.message || 'Worker failed to start') }); };
      // copy so that the canvas-derived buffer stays valid for the main thread
      var copy = new Uint8ClampedArray(prep.rgba);
      worker.postMessage({ buffer: copy.buffer, width: prep.width, height: prep.height, settings: settings }, [copy.buffer]);
    });
  }

  function runOnMainThread(prep, settings, onProgress) {
    return new Promise(function (resolve, reject) {
      var job = WS.Detection.createJob(prep.rgba, prep.width, prep.height, settings);
      var total = 0, i = 0, done = 0;
      job.steps.forEach(function (s) { total += s.weight; });
      function next() {
        if (cancelled) { reject(new Error('cancelled')); return; }
        if (i >= job.steps.length) {
          var res = job.finish(); res.timings = job.ctx.timings; resolve(res); return;
        }
        var st = job.steps[i];
        onProgress && onProgress(done / total, st.label);
        setTimeout(function () {
          try { var t0 = Date.now(); st.run(); job.ctx.timings[st.label] = Date.now() - t0; } catch (e) { reject(e); return; }
          done += st.weight; i++; next();
        }, 20);
      }
      next();
    });
  }

  /**
   * Analyse a decoded image.
   * @returns {Promise<{result:Object,prep:Object,usedWorker:boolean}>}
   */
  function analyse(loaded, settings, onProgress) {
    cancelled = false;
    onProgress && onProgress(0, 'Pre-processing: resizing image');
    var prep;
    try { prep = prepare(loaded.img, settings.resolution); }
    catch (e) { return Promise.reject(e); }
    var started = Date.now();
    return runInWorker(prep, settings, onProgress).then(function (result) {
      return { result: result, prep: prep, usedWorker: true, elapsedMs: Date.now() - started };
    }, function (err) {
      if (err && err.fallback) {
        return runOnMainThread(prep, settings, onProgress).then(function (result) {
          return { result: result, prep: prep, usedWorker: false, elapsedMs: Date.now() - started };
        });
      }
      throw err;
    });
  }

  function cancel() {
    cancelled = true;
    if (currentWorker) { currentWorker.terminate(); currentWorker = null; }
    if (currentReject) { var r = currentReject; currentReject = null; r(new Error('cancelled')); }
  }

  WS.ImageProcessor = {
    validateFile: validateFile, loadImage: loadImage, prepare: prepare, analyse: analyse, cancel: cancel,
    ALLOWED_EXT: ALLOWED_EXT, MAX_BYTES: MAX_BYTES
  };
})();

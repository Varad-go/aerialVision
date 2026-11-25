/*
 * WasteScan – utils.js : tiny shared helpers (DOM, formatting, toasts, downloads, event bus, safe storage).
 */
(function () {
  'use strict';
  var WS = window.WS = window.WS || {};

  var U = {};

  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  U.escapeHtml = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  U.icon = function (name, cls) {
    return '<svg class="icon' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  };

  U.fmtInt = function (n) { return Math.round(n).toLocaleString('en-US'); };
  U.fmtPct = function (n, d) { return (Number(n) || 0).toFixed(d == null ? 1 : d) + '%'; };
  U.fmtBytes = function (b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  };
  U.fmtMP = function (px) { return (px / 1e6).toFixed(2) + ' MP'; };
  U.fmtDate = function (iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' +
           d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };
  U.fmtDateShort = function (iso) { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }); };
  /** hectares from pixel count and ground sampling distance (m/pixel of the ORIGINAL image) */
  U.hectares = function (originalPixels, gsd) { return gsd > 0 ? originalPixels * gsd * gsd / 10000 : 0; };
  U.fmtHa = function (ha) {
    if (ha >= 100) return U.fmtInt(ha) + ' ha';
    if (ha >= 1) return ha.toFixed(1) + ' ha';
    return ha.toFixed(2) + ' ha';
  };
  U.clamp = function (x, a, b) { return x < a ? a : (x > b ? b : x); };
  U.debounce = function (fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; };
  U.uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); };
  U.baseName = function (name) { return String(name || 'image').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_'); };
  U.stamp = function () {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  };

  /* ---- toasts */
  U.toast = function (msg, type, ms) {
    var box = document.getElementById('toasts');
    if (!box) return;
    var el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = U.icon(type === 'error' || type === 'warn' ? 'alert' : 'check') + '<span>' + U.escapeHtml(msg) + '</span>';
    box.appendChild(el);
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 320); }, ms || (type === 'error' ? 7000 : 4200));
  };

  /* ---- downloads (local only: Blob + object URL) */
  U.download = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 1500);
  };

  /* ---- tiny event bus */
  var handlers = {};
  WS.bus = {
    on: function (evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); },
    emit: function (evt, data) { (handlers[evt] || []).slice().forEach(function (fn) { try { fn(data); } catch (e) { console.error('[WasteScan] handler for "' + evt + '" failed:', e); } }); }
  };

  /* ---- storage that never throws (private mode, quota, disabled) */
  U.store = {
    get: function (key, fallback) {
      try { var v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    }
  };

  /* ---- modal */
  U.openModal = function (title, html) {
    var m = document.getElementById('modal');
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = html;
    m.hidden = false;
    document.body.style.overflow = 'hidden';
    return document.getElementById('modalBody');
  };
  U.closeModal = function () {
    var m = document.getElementById('modal');
    if (!m || m.hidden) return;
    m.hidden = true; document.body.style.overflow = '';
  };

  WS.U = U;
})();

/*
 * WasteScan – pdf.js : a small, self-contained PDF 1.4 writer (no libraries, works offline).
 * Supports: pages, text (standard Helvetica / Helvetica-Bold, WinAnsi), rectangles, lines, JPEG images.
 * Coordinates use points with the origin at the TOP-LEFT of the page; text y is the baseline.
 */
(function () {
  'use strict';
  var WS = window.WS = window.WS || {};

  // Helvetica advance widths (1/1000 em) for ASCII 32..126
  var HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  var HELV_B = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

  // Unicode characters outside Latin-1 that exist in WinAnsi, or ASCII fall-backs
  var MAP = { '–': 0x96, '—': 0x97, '•': 0x95, '“': 0x93, '”': 0x94, '‘': 0x91, '’': 0x92, '…': 0x85, '€': 0x80 };
  var ALT = { '≥': '>=', '≤': '<=', '→': '->', '≈': '~', '✓': 'v', '−': '-', 'ō': 'o' };

  function toBytes(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i), c = s.charCodeAt(i);
      if (c < 128 || (c >= 160 && c <= 255)) out.push(c);
      else if (MAP[ch] !== undefined) out.push(MAP[ch]);
      else if (ALT[ch] !== undefined) { for (var k = 0; k < ALT[ch].length; k++) out.push(ALT[ch].charCodeAt(k)); }
      else out.push(63);
    }
    return out;
  }
  function esc(s) {
    var b = toBytes(s), o = '';
    for (var i = 0; i < b.length; i++) {
      var c = b[i];
      if (c === 40 || c === 41 || c === 92) o += '\\' + String.fromCharCode(c);
      else if (c < 32 || c > 126) o += '\\' + ('00' + c.toString(8)).slice(-3);
      else o += String.fromCharCode(c);
    }
    return o;
  }
  function num(n) { return (Math.round(n * 100) / 100).toString(); }
  function col(c) { return num(c[0] / 255) + ' ' + num(c[1] / 255) + ' ' + num(c[2] / 255); }
  function ascii(s) { var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; }

  function Doc(opts) {
    opts = opts || {};
    this.W = opts.width || 595.28; this.H = opts.height || 841.89;
    this.pages = []; this.cur = -1; this.images = []; this.title = opts.title || 'Document';
  }
  var P = Doc.prototype;

  P.addPage = function () { this.pages.push([]); this.cur = this.pages.length - 1; return this.cur; };
  P.setPage = function (i) { this.cur = i; };
  P.op = function (s) { this.pages[this.cur].push(s); };

  P.textWidth = function (str, size, bold) {
    var t = bold ? HELV_B : HELV, w = 0, b = toBytes(String(str));
    for (var i = 0; i < b.length; i++) { var c = b[i]; w += (c >= 32 && c <= 126) ? t[c - 32] : 556; }
    return w * size / 1000;
  };

  P.text = function (str, x, y, o) {
    o = o || {};
    var size = o.size || 10, bold = !!o.bold, color = o.color || [23, 35, 29];
    var w = (o.align === 'right' || o.align === 'center') ? this.textWidth(str, size, bold) : 0;
    if (o.align === 'right') x -= w; else if (o.align === 'center') x -= w / 2;
    this.op('BT ' + col(color) + ' rg /' + (bold ? 'F2' : 'F1') + ' ' + num(size) + ' Tf ' + num(x) + ' ' + num(this.H - y) + ' Td (' + esc(String(str)) + ') Tj ET');
  };

  P.wrap = function (str, maxW, size, bold) {
    var lines = [];
    String(str).split(/\n/).forEach(function (para) {
      var words = para.split(/\s+/), line = '';
      words.forEach(function (w) {
        if (!w) return;
        var t = line ? line + ' ' + w : w;
        if (this.textWidth(t, size, bold) <= maxW) line = t;
        else { if (line) lines.push(line); line = w; }
      }, this);
      lines.push(line);
    }, this);
    return lines;
  };

  /** Draw wrapped text; returns the y below the last line. */
  P.paragraph = function (str, x, y, maxW, o) {
    o = o || {};
    var size = o.size || 10, lh = o.lineHeight || size * 1.4;
    var lines = this.wrap(str, maxW, size, o.bold);
    for (var i = 0; i < lines.length; i++) { this.text(lines[i], x, y + size, o); y += lh; }
    return y;
  };

  P.rect = function (x, y, w, h, o) {
    o = o || {};
    var yy = this.H - y - h, ops = '';
    if (o.radius) ops = this._rr(x, yy, w, h, o.radius); else ops = num(x) + ' ' + num(yy) + ' ' + num(w) + ' ' + num(h) + ' re';
    var s = 'q ';
    if (o.fill) s += col(o.fill) + ' rg ';
    if (o.stroke) s += col(o.stroke) + ' RG ' + num(o.lw || 0.75) + ' w ';
    s += ops + ' ' + (o.fill && o.stroke ? 'B' : (o.fill ? 'f' : 'S')) + ' Q';
    this.op(s);
  };
  P._rr = function (x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2); var k = r * 0.5523;
    return num(x + r) + ' ' + num(y) + ' m ' + num(x + w - r) + ' ' + num(y) + ' l ' +
      num(x + w - r + k) + ' ' + num(y) + ' ' + num(x + w) + ' ' + num(y + r - k) + ' ' + num(x + w) + ' ' + num(y + r) + ' c ' +
      num(x + w) + ' ' + num(y + h - r) + ' l ' +
      num(x + w) + ' ' + num(y + h - r + k) + ' ' + num(x + w - r + k) + ' ' + num(y + h) + ' ' + num(x + w - r) + ' ' + num(y + h) + ' c ' +
      num(x + r) + ' ' + num(y + h) + ' l ' +
      num(x + r - k) + ' ' + num(y + h) + ' ' + num(x) + ' ' + num(y + h - r + k) + ' ' + num(x) + ' ' + num(y + h - r) + ' c ' +
      num(x) + ' ' + num(y + r) + ' l ' +
      num(x) + ' ' + num(y + r - k) + ' ' + num(x + r - k) + ' ' + num(y) + ' ' + num(x + r) + ' ' + num(y) + ' c h';
  };

  P.line = function (x1, y1, x2, y2, o) {
    o = o || {};
    this.op('q ' + col(o.color || [200, 210, 204]) + ' RG ' + num(o.lw || 0.75) + ' w ' + num(x1) + ' ' + num(this.H - y1) + ' m ' + num(x2) + ' ' + num(this.H - y2) + ' l S Q');
  };

  /** Register a JPEG (data URL) and return its resource name. */
  P.addJPEG = function (dataUrl, wPx, hPx) {
    var b64 = dataUrl.split(',')[1], bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    this.images.push({ bytes: bytes, w: wPx, h: hPx });
    return 'Im' + this.images.length;
  };
  P.image = function (name, x, y, w, h) {
    this.op('q ' + num(w) + ' 0 0 ' + num(h) + ' ' + num(x) + ' ' + num(this.H - y - h) + ' cm /' + name + ' Do Q');
  };

  P.save = function () {
    var chunks = [], offsets = [], length = 0, self = this;
    function push(b) { chunks.push(b); length += b.length; }
    function obj(id, body) { offsets[id] = length; push(ascii(id + ' 0 obj\n')); push(typeof body === 'string' ? ascii(body) : body); push(ascii('\nendobj\n')); }
    var nImg = this.images.length, nPg = this.pages.length;
    var firstImg = 5, firstPage = firstImg + nImg;          // each page: content obj + page obj
    var total = firstPage + nPg * 2 - 1;
    push(ascii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    var kids = [];
    for (var p = 0; p < nPg; p++) kids.push((firstPage + p * 2 + 1) + ' 0 R');
    obj(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + nPg + ' >>');
    obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    var xo = '';
    this.images.forEach(function (im, i) {
      var id = firstImg + i;
      xo += '/Im' + (i + 1) + ' ' + id + ' 0 R ';
      var head = ascii('<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.bytes.length + ' >>\nstream\n');
      var all = new Uint8Array(head.length + im.bytes.length + 10);
      all.set(head, 0); all.set(im.bytes, head.length); all.set(ascii('\nendstream'), head.length + im.bytes.length);
      offsets[id] = length; push(ascii(id + ' 0 obj\n')); push(all.subarray(0, all.length - 0)); push(ascii('\nendobj\n'));
    });
    var res = '<< /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ' + xo + '>> >>';
    this.pages.forEach(function (ops, i) {
      var cid = firstPage + i * 2, pid = cid + 1, stream = ops.join('\n');
      obj(cid, '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
      obj(pid, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + num(self.W) + ' ' + num(self.H) + '] /Resources ' + res + ' /Contents ' + cid + ' 0 R >>');
    });
    var infoId = total + 1;
    var d = new Date(), pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var ds = 'D:' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    obj(infoId, '<< /Title (' + esc(this.title) + ') /Producer (WasteScan) /Creator (WasteScan) /CreationDate (' + ds + ') >>');
    var xref = length;
    var x = 'xref\n0 ' + (infoId + 1) + '\n0000000000 65535 f \n';
    for (var i = 1; i <= infoId; i++) x += ('0000000000' + offsets[i]).slice(-10) + ' 00000 n \n';
    x += 'trailer\n<< /Size ' + (infoId + 1) + ' /Root 1 0 R /Info ' + infoId + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    push(ascii(x));
    return new Blob(chunks, { type: 'application/pdf' });
  };

  WS.PDF = { Doc: Doc };
})();

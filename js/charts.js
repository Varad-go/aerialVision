/*
 * WasteScan – charts.js : dependency-free SVG charts (doughnut, bar, line) with tooltips.
 * Colours for axes/text come from CSS variables so the charts follow the light/dark theme.
 */
(function () {
  'use strict';
  var WS = window.WS = window.WS || {};
  var U = WS.U;
  var NS = 'http://www.w3.org/2000/svg';

  function svgEl(name, attrs) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function prep(container) {
    container.innerHTML = '';
    container.style.position = 'relative';
    var tip = document.createElement('div');
    tip.className = 'chart-tip';
    container.appendChild(tip);
    return tip;
  }
  function empty(container, msg) {
    container.innerHTML = '<div class="chart-empty">' + U.escapeHtml(msg || 'No data to display yet.') + '</div>';
  }
  function bindTip(el, tip, container, html) {
    function move(ev) {
      var r = container.getBoundingClientRect();
      tip.style.left = (ev.clientX - r.left) + 'px';
      tip.style.top = (ev.clientY - r.top) + 'px';
    }
    el.addEventListener('mouseenter', function (ev) { tip.innerHTML = html; tip.classList.add('show'); move(ev); });
    el.addEventListener('mousemove', move);
    el.addEventListener('mouseleave', function () { tip.classList.remove('show'); });
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var n = v / p;
    var m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return m * p;
  }
  function polar(cx, cy, r, a) { return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
  function arcPath(cx, cy, r0, r1, a0, a1) {
    var large = a1 - a0 > Math.PI ? 1 : 0;
    var p0 = polar(cx, cy, r1, a0), p1 = polar(cx, cy, r1, a1), p2 = polar(cx, cy, r0, a1), p3 = polar(cx, cy, r0, a0);
    return 'M' + p0[0] + ' ' + p0[1] + ' A' + r1 + ' ' + r1 + ' 0 ' + large + ' 1 ' + p1[0] + ' ' + p1[1] +
           ' L' + p2[0] + ' ' + p2[1] + ' A' + r0 + ' ' + r0 + ' 0 ' + large + ' 0 ' + p3[0] + ' ' + p3[1] + ' Z';
  }

  /**
   * Doughnut chart.
   * @param items [{label, value, color}]   opts {centerMain, centerSub, fmt(value,pct)}
   */
  function doughnut(container, items, opts) {
    opts = opts || {};
    var total = items.reduce(function (a, i) { return a + i.value; }, 0);
    if (!(total > 0)) { empty(container, opts.emptyText); return; }
    var tip = prep(container);
    var wrap = document.createElement('div'); wrap.className = 'donut-wrap';
    var svg = svgEl('svg', { viewBox: '0 0 200 200', class: 'chart-svg', role: 'img', 'aria-label': opts.aria || 'Doughnut chart' });
    var cx = 100, cy = 100, r0 = 60, r1 = 92;
    var a = -Math.PI / 2, gap = items.filter(function (i) { return i.value > 0; }).length > 1 ? 0.012 : 0;
    items.forEach(function (it) {
      if (!(it.value > 0)) return;
      var frac = it.value / total, a1 = a + frac * Math.PI * 2;
      var pct = frac * 100;
      var path;
      if (frac > 0.9999) {
        path = svgEl('path', { d: arcPath(cx, cy, r0, r1, -Math.PI / 2, Math.PI * 1.5 - 0.0001), fill: it.color });
      } else {
        path = svgEl('path', { d: arcPath(cx, cy, r0, r1, a + gap, a1 - gap), fill: it.color });
      }
      path.setAttribute('class', 'seg-arc');
      path.addEventListener('mouseenter', function () { svg.querySelectorAll('.seg-arc').forEach(function (p) { p.style.opacity = p === path ? 1 : 0.45; }); });
      path.addEventListener('mouseleave', function () { svg.querySelectorAll('.seg-arc').forEach(function (p) { p.style.opacity = 1; }); });
      bindTip(path, tip, container, '<b>' + U.escapeHtml(it.label) + '</b><br>' + (opts.fmt ? opts.fmt(it.value, pct) : pct.toFixed(1) + '%'));
      svg.appendChild(path);
      a = a1;
    });
    if (opts.centerMain) {
      var t1 = svgEl('text', { x: cx, y: cy + 2, 'text-anchor': 'middle', class: 'center-main' }); t1.textContent = opts.centerMain;
      var t2 = svgEl('text', { x: cx, y: cy + 20, 'text-anchor': 'middle', class: 'center-sub' }); t2.textContent = opts.centerSub || '';
      svg.appendChild(t1); svg.appendChild(t2);
    }
    wrap.appendChild(svg);
    var legend = document.createElement('div'); legend.className = 'chart-legend';
    var ul = document.createElement('ul');
    items.forEach(function (it) {
      var li = document.createElement('li');
      var pct = it.value / total * 100;
      li.innerHTML = '<span class="sw" style="background:' + it.color + '"></span><span>' + U.escapeHtml(it.label) + '</span><b>' + (opts.legendFmt ? opts.legendFmt(it.value, pct) : pct.toFixed(1) + '%') + '</b>';
      ul.appendChild(li);
    });
    legend.appendChild(ul); wrap.appendChild(legend);
    container.appendChild(wrap);
  }

  /**
   * Vertical bar chart.  items [{label, value, color}]   opts {fmt(v), max, ticks}
   */
  function bars(container, items, opts) {
    opts = opts || {};
    var vals = items.map(function (i) { return i.value; });
    var maxV = Math.max.apply(null, vals);
    if (!items.length || !(maxV > 0) && !opts.allowZero) { empty(container, opts.emptyText); return; }
    var tip = prep(container);
    var W = 420, H = 240, ml = 46, mr = 10, mt = 18, mb = 38;
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart-svg', role: 'img', 'aria-label': opts.aria || 'Bar chart' });
    var top = opts.max || niceMax(maxV || 1), fmt = opts.fmt || function (v) { return String(Math.round(v * 100) / 100); };
    var ticks = opts.ticks || 4, iw = W - ml - mr, ih = H - mt - mb, i;
    for (i = 0; i <= ticks; i++) {
      var y = mt + ih - ih * i / ticks, v = top * i / ticks;
      svg.appendChild(svgEl('line', { x1: ml, x2: W - mr, y1: y, y2: y, class: 'grid' }));
      var tl = svgEl('text', { x: ml - 7, y: y + 3.5, 'text-anchor': 'end', class: 'axis-label' });
      tl.textContent = (opts.axisFmt || fmt)(v);
      svg.appendChild(tl);
    }
    var slot = iw / items.length, bw = Math.min(54, slot * 0.58);
    items.forEach(function (it, idx) {
      var h = Math.max(it.value > 0 ? 2 : 0, ih * it.value / top);
      var x = ml + slot * idx + (slot - bw) / 2, y2 = mt + ih - h;
      var rect = svgEl('rect', { x: x, y: y2, width: bw, height: h, rx: 5, fill: it.color, class: 'bar' });
      rect.addEventListener('mouseenter', function () { svg.querySelectorAll('.bar').forEach(function (b) { b.style.opacity = b === rect ? 1 : 0.5; }); });
      rect.addEventListener('mouseleave', function () { svg.querySelectorAll('.bar').forEach(function (b) { b.style.opacity = 1; }); });
      bindTip(rect, tip, container, '<b>' + U.escapeHtml(it.label) + '</b><br>' + (opts.tipFmt ? opts.tipFmt(it) : fmt(it.value)));
      svg.appendChild(rect);
      var vl = svgEl('text', { x: x + bw / 2, y: y2 - 5, 'text-anchor': 'middle', class: 'val-label' }); vl.textContent = fmt(it.value);
      svg.appendChild(vl);
      var cl = svgEl('text', { x: x + bw / 2, y: H - mb + 16, 'text-anchor': 'middle', class: 'axis-label' }); cl.textContent = it.label;
      svg.appendChild(cl);
    });
    container.appendChild(svg);
  }

  /**
   * Area/line chart.  points [{label, value}]   opts {fmt, color, yLabel}
   */
  function line(container, points, opts) {
    opts = opts || {};
    if (!points.length) { empty(container, opts.emptyText); return; }
    var tip = prep(container);
    var W = 640, H = 240, ml = 44, mr = 14, mt = 16, mb = 34;
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart-svg', role: 'img', 'aria-label': opts.aria || 'Line chart' });
    var color = opts.color || '#1f7a4d', fmt = opts.fmt || function (v) { return v.toFixed(1); };
    var maxV = Math.max.apply(null, points.map(function (p) { return p.value; }));
    var top = niceMax(maxV || 1), iw = W - ml - mr, ih = H - mt - mb, i;
    var gid = 'lg' + Math.random().toString(36).slice(2, 7);
    var defs = svgEl('defs', {});
    var lg = svgEl('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
    lg.appendChild(svgEl('stop', { offset: '0', 'stop-color': color, 'stop-opacity': '.32' }));
    lg.appendChild(svgEl('stop', { offset: '1', 'stop-color': color, 'stop-opacity': '0' }));
    defs.appendChild(lg); svg.appendChild(defs);
    for (i = 0; i <= 4; i++) {
      var y = mt + ih - ih * i / 4;
      svg.appendChild(svgEl('line', { x1: ml, x2: W - mr, y1: y, y2: y, class: 'grid' }));
      var tl = svgEl('text', { x: ml - 7, y: y + 3.5, 'text-anchor': 'end', class: 'axis-label' }); tl.textContent = fmt(top * i / 4);
      svg.appendChild(tl);
    }
    var n = points.length;
    function px(idx) { return n === 1 ? ml + iw / 2 : ml + iw * idx / (n - 1); }
    function py(v) { return mt + ih - ih * v / top; }
    var d = points.map(function (p, idx) { return (idx ? 'L' : 'M') + px(idx) + ' ' + py(p.value); }).join(' ');
    if (n > 1) svg.appendChild(svgEl('path', { d: d + ' L' + px(n - 1) + ' ' + (mt + ih) + ' L' + px(0) + ' ' + (mt + ih) + ' Z', fill: 'url(#' + gid + ')' }));
    svg.appendChild(svgEl('path', { d: d, fill: 'none', stroke: color, 'stroke-width': 2.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    var step = Math.max(1, Math.ceil(n / 7));
    points.forEach(function (p, idx) {
      var c = svgEl('circle', { cx: px(idx), cy: py(p.value), r: 4, stroke: color, 'stroke-width': 2.2 });
      c.style.fill = 'var(--surface)';
      svg.appendChild(c);
      var hit = svgEl('circle', { cx: px(idx), cy: py(p.value), r: 13, class: 'hit' });
      hit.addEventListener('mouseenter', function () { c.setAttribute('r', 6); });
      hit.addEventListener('mouseleave', function () { c.setAttribute('r', 4); });
      bindTip(hit, tip, container, '<b>' + U.escapeHtml(p.label) + '</b><br>' + fmt(p.value) + (p.extra ? '<br>' + U.escapeHtml(p.extra) : ''));
      svg.appendChild(hit);
      if (idx % step === 0 || idx === n - 1) {
        var xl = svgEl('text', { x: px(idx), y: H - mb + 17, 'text-anchor': 'middle', class: 'axis-label' }); xl.textContent = p.label;
        svg.appendChild(xl);
      }
    });
    container.appendChild(svg);
  }

  WS.Charts = { doughnut: doughnut, bars: bars, line: line };
})();

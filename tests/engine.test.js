/*
 * WasteScan – automated engine tests (Node, no dependencies):  node tests/engine.test.js
 * They exercise the REAL image-processing pipeline on synthetic scenes.
 */
'use strict';
var assert = require('assert');
require('../js/classifier.js');
require('../js/detection.js');
var scene = require('../tools/scene.js');
var WS = globalThis.WS;
var D = WS.Detection, passed = 0;

function run(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; } }
function analyse(sc, settings) { return D.runSync(D.createJob(sc.rgba, sc.width, sc.height, settings)); }
function solid(w, h, r, g, b) { var a = new Uint8ClampedArray(w * h * 4); for (var i = 0; i < w * h; i++) { a[i * 4] = r; a[i * 4 + 1] = g; a[i * 4 + 2] = b; a[i * 4 + 3] = 255; } return { width: w, height: h, rgba: a }; }

var sc = scene.generateScene({ width: 800, height: 560 });
var res = analyse(sc, {});

run('detects the simulated dump sites with good recall', function () {
  var tp = 0, fn = 0, n = sc.width * sc.height;
  for (var i = 0; i < n; i++) if (sc.truth[i]) { if (res.labels[i] === 0) tp++; else fn++; }
  assert.ok(tp / (tp + fn) > 0.8, 'recall ' + (tp / (tp + fn)).toFixed(2));
});
run('every simulated dump overlaps a detected region', function () {
  sc.dumps.forEach(function (d) {
    var hit = res.regions.some(function (r) { return Math.hypot(r.cx - d.cx, r.cy - d.cy) < d.radius * 1.2; });
    assert.ok(hit, 'dump ' + d.id + ' not found');
  });
});
run('precision is reasonable (most flagged pixels are real dumps)', function () {
  var tp = 0, fp = 0, n = sc.width * sc.height;
  for (var i = 0; i < n; i++) if (res.labels[i] === 0) { if (sc.truth[i]) tp++; else fp++; }
  assert.ok(tp / (tp + fp) > 0.6, 'precision ' + (tp / (tp + fp)).toFixed(2));
});
run('river, forest and farmland are not flagged', function () {
  assert.ok(res.wastePct < 4, 'waste % ' + res.wastePct);
  assert.ok(res.percentages[3] > 2, 'water class missing');
  assert.ok(res.percentages[1] > 20, 'vegetation class missing');
});
run('class counts add up to the pixel total and pct to 100', function () {
  assert.strictEqual(res.counts.reduce(function (a, b) { return a + b; }, 0), res.pixels);
  assert.ok(Math.abs(res.percentages.reduce(function (a, b) { return a + b; }, 0) - 100) < 1e-6);
});
run('regions are sorted by area and consistent with the label map', function () {
  for (var i = 1; i < res.regions.length; i++) assert.ok(res.regions[i - 1].area >= res.regions[i].area);
  var wastePx = res.regions.reduce(function (a, r) { return a + r.area; }, 0);
  assert.strictEqual(wastePx, res.counts[0]);
});
run('higher sensitivity never reduces flagged area', function () {
  var lo = analyse(sc, { sensitivity: 20 }), hi = analyse(sc, { sensitivity: 80 });
  assert.ok(hi.counts[0] >= lo.counts[0], lo.counts[0] + ' vs ' + hi.counts[0]);
});
run('raising the colour-variation gate removes candidates', function () {
  var strict = analyse(sc, { colourVariation: 80 });
  assert.ok(strict.counts[0] < res.counts[0]);
});
run('a large minimum region size removes small candidates', function () {
  var big = analyse(sc, { minRegionPct: 1.5 });
  assert.strictEqual(big.regions.length, 0);
});
run('uniform green field → vegetation, no candidates, no crash', function () {
  var g = solid(300, 200, 70, 140, 60), r = analyse(g, {});
  assert.strictEqual(r.regions.length, 0);
  assert.ok(r.percentages[1] > 95);
  assert.ok(r.warnings.some(function (w) { return w.code === 'flat'; }), 'flat warning expected');
});
run('uniform blue surface → water', function () {
  var r = analyse(solid(300, 200, 30, 90, 150), {});
  assert.ok(r.percentages[3] > 95);
});
run('grayscale image triggers a reliability warning', function () {
  var g = scene.generateScene({ width: 300, height: 200, dumps: false });
  for (var i = 0; i < 300 * 200; i++) { var l = 0.3 * g.rgba[i * 4] + 0.59 * g.rgba[i * 4 + 1] + 0.11 * g.rgba[i * 4 + 2]; g.rgba[i * 4] = g.rgba[i * 4 + 1] = g.rgba[i * 4 + 2] = l; }
  var r = analyse(g, {});
  assert.ok(r.warnings.some(function (w) { return w.code === 'grey'; }));
});
run('scene without dumps yields little or no waste', function () {
  var nd = scene.generateScene({ width: 800, height: 560, dumps: false });
  var r = analyse(nd, {});
  assert.ok(r.wastePct < 2, 'waste % ' + r.wastePct);
});
run('progress callback reaches 100%', function () {
  var last = 0;
  D.runSync(D.createJob(sc.rgba, sc.width, sc.height, {}), function (f) { last = f; });
  assert.strictEqual(last, 1);
});
console.log('\n' + passed + ' passed' + (process.exitCode ? ' (with failures)' : ''));

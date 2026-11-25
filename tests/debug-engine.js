/*
 * Developer helper: runs the engine on the synthetic scene, prints a summary and
 * writes a side-by-side PNG (original | classification | overlay) to the folder
 * given as argv[2] so the result can be inspected visually.
 *   node tests/debug-engine.js <outDir> [sensitivity] [cv] [minPct]
 */
'use strict';
var fs = require('fs'), path = require('path');
require('../js/classifier.js');
require('../js/detection.js');
var scene = require('../tools/scene.js');
var png = require('../tools/png.js');
var WS = globalThis.WS;

var out = process.argv[2] || '.';
var settings = {
  sensitivity: +(process.argv[3] || 50),
  colourVariation: +(process.argv[4] || 22),
  minRegionPct: +(process.argv[5] || 0.08),
  resolution: 'medium'
};
var sc = scene.generateScene({ width: 800, height: 560 });
var t0 = Date.now();
var res = WS.Detection.runSync(WS.Detection.createJob(sc.rgba, sc.width, sc.height, settings));
console.log('time ms', Date.now() - t0, res.timings);
console.log('thr', res.threshold.toFixed(3), 'waste%', res.wastePct.toFixed(2), 'regions', res.regions.length, 'discarded', res.discardedRegions);
console.log('class %', res.percentages.map(function (v) { return v.toFixed(1); }).join(' / '));
var tp = 0, fp = 0, fn = 0, n = sc.width * sc.height;
for (var i = 0; i < n; i++) {
  var det = res.labels[i] === 0, tr = sc.truth[i] === 1;
  if (det && tr) tp++; else if (det) fp++; else if (tr) fn++;
}
console.log('TP', tp, 'FP', fp, 'FN', fn, 'precision', (tp / (tp + fp || 1)).toFixed(3), 'recall', (tp / (tp + fn || 1)).toFixed(3));
res.regions.slice(0, 12).forEach(function (r) {
  console.log(' R' + r.id, 'area', r.area, 'pct', r.pct.toFixed(2), 'score', r.score, r.priority, 'at', Math.round(r.cx), Math.round(r.cy), 'compact', r.compactness.toFixed(2));
});
console.log('warnings', res.warnings.map(function (x) { return x.code; }));

// side-by-side image
var W = sc.width, H = sc.height, comp = new Uint8ClampedArray(W * 3 * H * 4);
var col = WS.Classifier.CLASS_INFO.map(function (c) { return c.color; });
for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
  var s = (y * W + x) * 4, i2 = y * W + x;
  var o1 = (y * W * 3 + x) * 4, o2 = (y * W * 3 + W + x) * 4, o3 = (y * W * 3 + 2 * W + x) * 4;
  for (var c = 0; c < 4; c++) comp[o1 + c] = sc.rgba[s + c];
  var cl = col[res.labels[i2]];
  comp[o2] = cl[0]; comp[o2 + 1] = cl[1]; comp[o2 + 2] = cl[2]; comp[o2 + 3] = 255;
  var isW = res.labels[i2] === 0, tr2 = sc.truth[i2] === 1;
  comp[o3] = isW ? 255 : sc.rgba[s] * 0.6; comp[o3 + 1] = isW ? 40 : sc.rgba[s + 1] * 0.6; comp[o3 + 2] = isW ? 40 : sc.rgba[s + 2] * 0.6; comp[o3 + 3] = 255;
  if (tr2 && !isW) { comp[o3] = 255; comp[o3 + 1] = 255; comp[o3 + 2] = 0; }   // missed truth = yellow
}
fs.writeFileSync(path.join(out, 'debug.png'), png.encodePNG(W * 3, H, comp));
console.log('wrote', path.join(out, 'debug.png'));

/*
 * WasteScan – sampledata.js
 * Locally generated, deterministic SAMPLE statistics shown on the dashboard before the user has analysed
 * anything. They are illustrative only and are always labelled "Sample" in the interface.
 */
(function () {
  'use strict';
  var WS = window.WS = window.WS || {};

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generate() {
    var rnd = mulberry32(20250214);
    var out = [], now = Date.now(), DAY = 86400000;
    for (var i = 0; i < 12; i++) {
      var waste = 0.4 + rnd() * 4.2;
      var veg = 28 + rnd() * 30, water = 2 + rnd() * 9, built = 4 + rnd() * 12;
      var barren = Math.max(1, 100 - waste - veg - water - built);
      var regions = Math.max(0, Math.round(waste * (1.2 + rnd() * 1.6)));
      var high = Math.round(regions * (0.25 + rnd() * 0.25)), med = Math.round(regions * (0.3 + rnd() * 0.2));
      var w = 3000 + Math.round(rnd() * 3000), h = 2000 + Math.round(rnd() * 2000);
      out.push({
        id: 'sample-' + (i + 1),
        sample: true,
        filename: 'sample_tile_' + (i + 1 < 10 ? '0' : '') + (i + 1) + '.jpg',
        date: new Date(now - (12 - i) * 4.5 * DAY - rnd() * DAY).toISOString(),
        width: w, height: h,
        wastePct: waste,
        regionsCount: regions,
        percentages: [waste, veg, built, water, barren],
        priorities: { High: high, Medium: Math.min(med, regions - high), Low: Math.max(0, regions - high - med) },
        gsd: 0.5,
        summary: 'Illustrative sample entry (not a real analysis).'
      });
    }
    return out;
  }

  WS.SampleData = { generate: generate };
})();

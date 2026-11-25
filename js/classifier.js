/*
 * WasteScan – classifier.js
 * -----------------------------------------------------------------------------
 * Pure, DOM-free colour-space helpers and the rule-based LAND-COVER classifier.
 * This file is loaded both on the main thread and inside the analysis Web Worker
 * (see imageProcessor.js), so it must not touch window / document / canvas.
 *
 * IMPORTANT: this is a *heuristic* RGB classifier. It is not a trained model and
 * its output is not scientifically validated.
 */
(function (root) {
  'use strict';

  function factory(WS) {
    // Class identifiers – order matches the project specification.
    var CLASS = { WASTE: 0, VEGETATION: 1, BUILT: 2, WATER: 3, BARREN: 4 };

    var CLASS_INFO = [
      { id: 0, key: 'waste',      name: 'Waste Dumping',  short: 'Suspected Waste', color: [229, 57, 53],  hex: '#e53935' },
      { id: 1, key: 'vegetation', name: 'Vegetation',     short: 'Vegetation',      color: [67, 160, 71],  hex: '#43a047' },
      { id: 2, key: 'built',      name: 'Built-up Area',  short: 'Built-up',        color: [120, 144, 156], hex: '#78909c' },
      { id: 3, key: 'water',      name: 'Water Bodies',   short: 'Water',           color: [30, 136, 229], hex: '#1e88e5' },
      { id: 4, key: 'barren',     name: 'Barren Land',    short: 'Barren',          color: [253, 216, 53], hex: '#fdd835' }
    ];

    /** Tunable constants for the base land-cover rules (not exposed in the UI). */
    var params = {
      darkValue: 0.22,       // HSV value below which a pixel counts as "dark"
      brightValue: 0.72,     // HSV value above which a low-saturation pixel counts as "bright"
      lowSat: 0.22,          // saturation below which a pixel is "neutral/grey"
      vegExg: 0.035,         // normalised excess-green threshold for vegetation
      waterSmoothStd: 9,     // local luma std-dev below which a surface is "smooth"
      barrenSatMin: 0.10,
      barrenSatMax: 0.65
    };

    /** RGB (0-255) -> [h(0-360), s(0-1), v(0-1)]. Written to `out` to avoid allocations. */
    function rgbToHsv(r, g, b, out) {
      var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      var d = mx - mn;
      var h = 0;
      if (d > 0) {
        if (mx === r) h = 60 * (((g - b) / d) % 6);
        else if (mx === g) h = 60 * ((b - r) / d + 2);
        else h = 60 * ((r - g) / d + 4);
        if (h < 0) h += 360;
      }
      out[0] = h;
      out[1] = mx === 0 ? 0 : d / mx;
      out[2] = mx / 255;
      return out;
    }

    /**
     * Quantise a colour into one of 8 coarse colour buckets. The local histogram
     * of these buckets is later used to measure *colour diversity* (waste tends
     * to mix many unrelated colours inside a small window).
     * 0 dark | 1 bright/white | 2 grey | 3 red/pink | 4 orange/brown/yellow
     * 5 green | 6 cyan/blue | 7 purple/magenta
     */
    function colourBucket(r, g, b, hsv) {
      var h = hsv[0], s = hsv[1], v = hsv[2];
      if (v < params.darkValue) return 0;
      if (s < params.lowSat) return v > params.brightValue ? 1 : 2;
      if (h < 15 || h >= 335) return 3;
      if (h < 70) return 4;
      if (h < 170) return 5;
      if (h < 262) return 6;
      return 7;
    }

    /**
     * Rule-based classification of ONE pixel into a base land-cover class
     * (never WASTE – waste is decided later from region-level evidence).
     * @param {number} lumaStd local luminance std-dev (texture) around the pixel
     */
    function classifyBase(r, g, b, hsv, lumaStd) {
      var h = hsv[0], s = hsv[1], v = hsv[2];
      var sum = r + g + b;
      if (sum < 1) return CLASS.BUILT;
      var exg = (2 * g - r - b) / sum;
      var smooth = lumaStd < params.waterSmoothStd;

      // 1) Water – smooth surfaces that are blue/teal dominant, or dark and bluish.
      if (smooth) {
        if (b >= r + 4 && b >= g - 6 && v > 0.08) return CLASS.WATER;
        if (v < 0.28 && b >= r - 2 && exg < 0.06) return CLASS.WATER;
      }

      // 2) Vegetation – excess-green index plus a green hue window.
      if (exg > params.vegExg && h >= 50 && h <= 175) return CLASS.VEGETATION;

      // 3) Barren land – warm brown/tan/sand tones (soil, dry fields, rock).
      var warm = r >= g - 2 && g >= b - 2 && h >= 10 && h <= 62;
      if (warm && s >= params.barrenSatMin && s <= params.barrenSatMax && v >= 0.28) return CLASS.BARREN;

      // 4) Built-up – neutral greys/whites (concrete, asphalt) and strongly coloured roofs.
      if (s < params.lowSat) return CLASS.BUILT;
      if ((h < 12 || h >= 340) && s > 0.35) return CLASS.BUILT;      // red / terracotta roofs
      if (h >= 175 && h < 262 && !smooth) return CLASS.BUILT;       // textured blue (roofing sheets)

      // 5) Fallbacks for the remaining ambiguous colours.
      if (v < 0.30) return CLASS.BUILT;
      if (warm) return CLASS.BARREN;
      if (exg > 0) return CLASS.VEGETATION;
      return CLASS.BUILT;
    }

    WS.Classifier = {
      CLASS: CLASS,
      CLASS_INFO: CLASS_INFO,
      params: params,
      rgbToHsv: rgbToHsv,
      colourBucket: colourBucket,
      classifyBase: classifyBase
    };
  }

  var g = root;
  g.WS = g.WS || {};
  (g.WS._factories = g.WS._factories || []).push(factory);
  factory(g.WS);
})(typeof self !== 'undefined' ? self : globalThis);

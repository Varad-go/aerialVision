# WasteScan – Identification of Illegal Waste Dumping Sites Using Aerial Image Analysis

> **Detect. Analyse. Protect.**

WasteScan is a browser-based environmental monitoring dashboard. You upload an aerial or satellite photograph and the
application examines its pixels **locally on your computer** to highlight areas that look like potential illegal waste
dumping, classify land cover, measure how much of the image is affected and export a report.

Final-year engineering project · Study area: **Satara–Songav region, Maharashtra, India**.

## Honest scope (please read)

* WasteScan uses **classical digital image processing and hand-written heuristic rules** on RGB values. It does **not** use
  a trained deep-learning model, a neural network, a satellite API or any online service.
* Results are **heuristic estimates**. They are not scientifically validated waste detection, and every highlighted area is
  only a *candidate* that must be verified by a person (for example by a field visit).
* The bundled demo images are **synthetic, computer-generated scenes** – not real satellite imagery. The automated tests use
  the same synthetic scenes, so the numbers they produce say nothing about accuracy on real imagery.
* The prototype relies only on RGB imagery; it does not use physical sensors.

## Features

| Area | What it does |
|---|---|
| Dashboard | Statistic cards, trend / doughnut / bar charts and recent history. **Sample** statistics (clearly badged) are shown until you have your own analyses; a toggle switches between "Your analyses" and "Sample statistics". |
| Upload | Drag & drop or browse (JPG, JPEG, PNG, WEBP), preview, file name / resolution / size, replace, remove, validation and clear error messages (unsupported, empty, corrupted, too small or too large files). |
| Analysis engine | Real per-pixel and neighbourhood image processing in a **Web Worker** (the UI stays responsive) with progress bar, cancel, and an automatic main-thread fallback. |
| Visualisation | Original · Processed (land-cover map) · Detection overlay · Score heat-map · Before/after comparison slider; zoom, pan, reset, full screen, opacity slider, region labels, legend, pixel read-out. |
| Results | Pixel counts and % for the five classes, number of connected regions, doughnut + bar chart, region table (area, % of image, score, High / Medium / Low priority), automatic summary, reliability warnings. |
| Settings | Sensitivity, colour-variation threshold, minimum region size, overlay transparency, analysis resolution, optional ground resolution (m/pixel → hectares), *Reanalyse Image*. Settings are remembered. |
| Report | Live report preview, **PDF** (own PDF writer), **CSV**, **detection PNG** and browser **Print** – all generated locally. |
| History | Stored in `localStorage` (statistics + two small thumbnails per analysis, never the full image); view, delete, clear all. |
| Extras | Dark / light mode, responsive sidebar, empty-state illustrations (SVG / CSS), About, How It Works and Methodology pages. |

## Run it

No build step, no installation, no internet connection.

**Option A – open the file:** double-click `index.html` (Chrome, Edge or Firefox). Everything works from `file://`
(the worker is created from an in-memory Blob, and the demo images are embedded as data-URLs so that canvas pixel access is
not blocked by the browser).

**Option B – tiny local web server** (optional):

```powershell
python -m http.server 8000
# then open http://localhost:8000
```

Run the automated engine tests (Node.js 18+, no dependencies):

```powershell
node tests/engine.test.js
```

## How to upload and analyse an image

1. Open **Upload & Analyse** (or press *Quick Upload*).
2. Drop an image on the drop-zone or click **Browse files** – or choose one of the bundled demo images.
3. Check the preview (file name, resolution, size). Use **Replace image** / **Remove** if needed.
4. Optionally tune **Detection settings** on the right (sensitivity, colour variation, minimum region size, resolution).
5. Click **Analyse Image**. A progress bar shows the processing steps. Analysis never starts automatically.
6. You are taken to **Results**: switch views, zoom, compare before/after, inspect the table and charts.
7. Change a setting and press **Reanalyse Image** to compare results.
8. Open **Report** to download the PDF, CSV or detection image. Every analysis is also saved in **History**.

## The image-processing algorithm

All code is in [`js/classifier.js`](js/classifier.js) and [`js/detection.js`](js/detection.js) (DOM-free, so it runs in the
worker and in Node).

1. **Pre-processing** – the image is drawn to a canvas at the chosen analysis resolution (long side 480 / 800 / 1200 px, aspect
   ratio kept, never enlarged) and the RGBA buffer is read. Luminance `0.299R + 0.587G + 0.114B`, HSV and an 8-way *colour bucket*
   (dark, bright, grey, red, orange/brown, green, blue, purple) are computed per pixel.
2. **Texture** – Sobel gradients; windowed (box filter, radius ≈ size/200) local luminance standard deviation, edge density and a
   *fourfold orientation coherence* (from the 4th power of the complex gradient). Straight edges and rectangular building
   grids are coherent ("regular"); chaotic debris is not.
3. **Colour** – local RGB variation `sqrt(σR² + σG² + σB²)` and the contrast between the local mean colour and a 3× larger surrounding window.
4. **Colour diversity** – entropy of the local colour-bucket histogram, the share of simultaneously bright **and** dark pixels, and the
   share of strongly saturated blue-to-magenta ("synthetic") colours.
5. **Land-cover classes** – rules: *water* (smooth + blue/teal, or dark and bluish), *vegetation* (excess-green `(2G−R−B)/(R+G+B)` + green hue),
   *barren* (warm brown / tan), *built-up* (neutral grey / white, red roofs, textured blue roofing); then a 5×5 majority filter.
6. **Waste-likelihood score** – weighted sum of the normalised cues (colour variation 0.20, diversity 0.18, irregularity 0.15, contrast 0.15,
   bright/dark mixing 0.13, texture 0.11, synthetic colour 0.08), reduced for calm water, flat surfaces and homogeneous green canopy, and set
   to zero below the **colour-variation threshold**.
7. **Region grouping** – `score ≥ 0.70 − 0.45 · sensitivity/100`; morphological opening (removes field edges and river banks) and closing;
   8-connected component labelling; regions below the **minimum size** or very elongated (axis ratio > 3.5) are discarded.
8. **Statistics** – final label map (waste = pixels inside accepted regions), pixel counts and percentages, region score
   `100 · (0.7 · mean + 0.3 · peak)` and priority (High ≥ 70, Medium ≥ 58, otherwise Low – heuristic only).
9. **Reliability checks** – warnings for tiny, grayscale, very dark / bright, blurry or uniform images and for implausibly high (> 35 %) coverage.

## Project structure

```
index.html                 application shell (all pages)
css/                       style.css (tokens, layout) · dashboard.css (components) · responsive.css (breakpoints, print)
js/utils.js                helpers, toasts, event bus, safe storage
js/classifier.js           colour spaces + rule-based land-cover classifier   (worker-safe)
js/detection.js            feature extraction, scoring, region grouping       (worker-safe)
js/imageProcessor.js       validation, resizing, Web Worker orchestration
js/upload.js               drag & drop upload, preview, demo images
js/visualization.js        interactive viewer, overlays, exports
js/results.js              results dashboard and summary text
js/charts.js               SVG doughnut / bar / line charts
js/history.js              localStorage history
js/pdf.js, js/report.js    PDF writer, report preview, CSV / image export
js/sampledata.js           deterministic SAMPLE statistics for the dashboard
js/app.js                  router, settings, theme, dashboard, orchestration
assets/logo.svg            logo
assets/sample-images/      synthetic demo images (PNG + data-URL script)
tools/                     synthetic scene generator, PNG encoder, sample generator
tests/                     engine tests (node tests/engine.test.js)
reports/                   a place to keep exported reports (the browser saves to its Downloads folder)
```

Regenerate the demo images with `node tools/generate-sample.js`.

## Limitations

* No ground-truth validation; accuracy on real imagery is unknown. Dense settlements, quarries, rocky ground, plastic-covered farmland,
  shadows and coloured roofs can be flagged; clean-looking waste can be missed.
* Only visible RGB is used (no infrared, spectral indices or thermal data). Oblique photographs and false-colour images are unsuitable.
* A browser cannot write to arbitrary folders, so exported files go to the browser's normal download location; `reports/` is a
  convenient place to keep them.
* `localStorage` is small (about 5 MB): the history keeps the 30 most recent analyses and sheds thumbnails automatically when storage is full.
* Very large images are down-sampled to the analysis resolution (and an 80 MB / 160-megapixel cap protects the browser).

## Browser support

Current Chrome, Edge and Firefox (desktop and mobile). Uses Canvas 2D, Web Workers, Blob URLs and localStorage only.

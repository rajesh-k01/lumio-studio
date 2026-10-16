#!/usr/bin/env node
"use strict";
/* Fit Lumio's "natural finish" stage (public/js/engine.js, naturalFinish) on one reference pair.
 *
 *   node ai/train/fit_natural.js <lumio_before_finish.png> <reference.jpg> <out.json> [holdout=0.3]
 *
 * <lumio_before_finish.png>  Lumio's result for a photo, with the finish stage off.
 * <reference.jpg>            Another tool's result for the same photo (resized to the same size here).
 * The bottom `holdout` fraction of rows is NOT used for fitting, so the result can be checked on pixels the fit never saw.
 *
 * What is fitted (about 60 numbers in total, so it cannot memorise a photo):
 *   1. For four detail bands (fine to coarse), a shrinkage curve: how big a detail of size m in Lumio ends up in the reference.
 *   2. A tone curve (17 knots), fitted after the detail step.
 *   3. One colour gain (saturation).
 * It matches statistics, not pixels. Nothing here is a neural network.
 */
const fs = require("fs");
const sharp = require("sharp");
const E = require("../../public/js/engine.js");

const SIGMAS = [0.8, 1.6, 3.2, 6.4];
const KNOTS = 12;
const MAXGAIN = Number(process.env.MAXGAIN) || 1.0;

async function loadRgb(file, w, h) {
  let img = sharp(file).removeAlpha();
  if (w) img = img.resize(w, h, { fit: "fill", kernel: "lanczos3" });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}
function lumaPlane(rgb) {
  const n = rgb.w * rgb.h, Y = new Float32Array(n);
  for (let i = 0; i < n; i++) Y[i] = 0.299 * rgb.data[i * 3] + 0.587 * rgb.data[i * 3 + 1] + 0.114 * rgb.data[i * 3 + 2];
  return Y;
}
function quantiles(arr, qs) { const a = Float32Array.from(arr).sort(); return qs.map((q) => a[Math.min(a.length - 1, Math.floor(q * a.length))]); }

(async () => {
  const [pre, ref, outFile, hold] = [process.argv[2], process.argv[3], process.argv[4], Number(process.argv[5]) || 0.3];
  if (!pre || !ref || !outFile) { console.error("usage: fit_natural.js <before.png> <reference.jpg> <out.json> [holdout]"); process.exit(1); }
  const L = await loadRgb(pre), W = await loadRgb(ref, L.w, L.h), w = L.w, h = L.h, n = w * h;
  const fitRows = Math.floor(h * (1 - hold)), fitN = fitRows * w, sc = E.naturalKit.sizeScale(w, h), sig = SIGMAS.map((s) => s * sc);
  const YL = lumaPlane(L), YW = lumaPlane(W);

  // 1. detail bands: collect |band_L| and |band_W| on the fit rows
  const bl = [], bw = [];
  E.naturalKit.decompose(YL, w, h, sig, (k, band) => { bl[k] = Float32Array.from(band.subarray(0, fitN)); });
  E.naturalKit.decompose(YW, w, h, sig, (k, band) => { bw[k] = Float32Array.from(band.subarray(0, fitN)); });
  const curves = [];
  for (let k = 0; k < SIGMAS.length; k++) {
    const mag = bl[k].map(Math.abs), ref2 = bw[k].map((v) => v * v);
    // bin edges at quantiles of Lumio's magnitude, so every bin has the same number of pixels
    const qs = []; for (let i = 0; i <= KNOTS; i++) qs.push(i === 0 ? 0 : (i / KNOTS) * 0.999);
    const edges = quantiles(mag, qs);
    const xs = [0], ys = [0];
    for (let i = 0; i < KNOTS; i++) {
      let s = 0, sx = 0, c = 0;
      for (let j = 0; j < fitN; j++) if (mag[j] >= edges[i] && (mag[j] < edges[i + 1] || i === KNOTS - 1)) { s += ref2[j]; sx += mag[j]; c++; }
      if (!c) continue;
      const x = sx / c, y = Math.sqrt(s / c); // energy matching: the RMS magnitude the reference has for details of this size
      if (x > xs[xs.length - 1] + 1e-3) { xs.push(x); ys.push(Math.min(y, x * MAXGAIN)); } // cap the gain: above 1 would amplify detail that may only be noise
    }
    for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1]); // monotone
    curves.push({ x: xs.map((v) => +v.toFixed(3)), y: ys.map((v) => +v.toFixed(3)) });
  }
  const params = { sigmas: SIGMAS, curves, tone: new Array(17).fill(0), chroma: 1 };

  // apply the detail step to the whole image, to fit the tone curve on its output
  const out = new Float32Array(n);
  const low = E.naturalKit.decompose(YL, w, h, sig, (k, band) => {
    for (let j = 0; j < n; j++) { const v = band[j], m = Math.abs(v), r = E.naturalKit.curveAt(curves[k], m); out[j] += v < 0 ? -r : r; }
  });
  for (let j = 0; j < n; j++) out[j] += low[j];

  // 2. tone curve: match the luma distribution on the fit rows, smoothed and limited
  const knotsY = [];
  const a = Float32Array.from(out.subarray(0, fitN)).sort(), b = Float32Array.from(YW.subarray(0, fitN)).sort();
  const delta = [];
  for (let i = 0; i < 17; i++) {
    const y = (i / 16) * 255, lo = lowerBound(a, y), q = lo / a.length, target = b[Math.min(b.length - 1, Math.floor(q * b.length))];
    delta.push(Math.max(-14, Math.min(14, target - y)));
    knotsY.push(y);
  }
  delta[0] = 0; delta[16] = 0;
  for (let pass = 0; pass < 3; pass++) for (let i = 1; i < 16; i++) delta[i] = (delta[i - 1] + 2 * delta[i] + delta[i + 1]) / 4;
  params.tone = delta.map((v) => +v.toFixed(2));

  // 3. colour gain: match the size of the colour differences (R-Y, G-Y, B-Y), RMS to RMS. (A least-squares fit would read low, because
  //    noise in Lumio's colour pulls the slope down.)
  let sl = 0, sr = 0;
  for (let j = 0; j < fitN; j++) for (let c = 0; c < 3; c++) { const l = L.data[j * 3 + c] - YL[j], r = W.data[j * 3 + c] - YW[j]; sl += l * l; sr += r * r; }
  params.chroma = +Math.sqrt(sr / sl).toFixed(3);
  params.fit = { rows: fitRows, of: h, holdout: hold, scale: +sc.toFixed(3) };
  fs.writeFileSync(outFile, JSON.stringify(params));
  console.log("fitted: chroma gain", params.chroma, "| tone", params.tone.join(","));
  curves.forEach((c, k) => console.log("band", k, "sigma", +(sig[k]).toFixed(2), "curve ratio at knots:", c.x.map((x, i) => (x ? (c.y[i] / x).toFixed(2) : "-")).join(" ")));
  function lowerBound(arr, v) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } return lo; }
})().catch((e) => { console.error(e); process.exit(1); });

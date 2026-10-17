/*
 * Lumio image engine.
 * One implementation used by the browser (window.LumioEngine) and by the Node
 * server (require). Everything works on RGBA Uint8ClampedArray data, so the
 * result of a local preview and a cloud render match.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LumioEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---------- settings ---------- */
  var DEFAULTS = {
    denoise: 0, sharpen: 0, contrast: 0, clarity: 0, dehaze: 0, autowb: 0,
    skin: 0, glow: 0, tilt: 0, natural: 0, calm: 0,
    bright: 0, shadows: 0, highlights: 0, sat: 0, warm: 0,
    vignette: 0, grain: 0,
    filter: "none", fstr: 70,
    style: "none", sstr: 60
  };
  var LIMITS = {
    denoise: [0, 100], sharpen: [0, 100], contrast: [0, 100], clarity: [0, 100], dehaze: [0, 100], autowb: [0, 100],
    skin: [0, 100], glow: [0, 100], tilt: [0, 100], natural: [0, 100], calm: [0, 100],
    bright: [-50, 50], shadows: [-50, 50], highlights: [-50, 50], sat: [-50, 50], warm: [-50, 50],
    vignette: [0, 100], grain: [0, 100], fstr: [0, 100], sstr: [0, 100]
  };
  var FILTER_IDS = ["none", "cinematic", "vivid", "film", "bw", "sepia", "cool", "warm", "fade",
    "noir", "matte", "tealorange", "golden", "cyber", "retro", "dream", "posterize"];
  var STYLE_IDS = ["none", "cartoon", "sketch", "mosaic"];

  var PRESETS = {
    "Auto fix": { denoise: 35, sharpen: 55, contrast: 60, clarity: 20, sat: 8 },
    "AI color": { autowb: 70, contrast: 55, clarity: 15, sat: 14, shadows: 8 },
    "Portrait": { denoise: 40, sharpen: 35, contrast: 40, skin: 55, glow: 20, bright: 4, sat: 6, warm: 6 },
    "Night view": { denoise: 70, sharpen: 45, contrast: 80, shadows: 25, bright: 10, sat: 12 },
    "Landscape": { sharpen: 60, contrast: 70, clarity: 35, dehaze: 30, sat: 18, highlights: -10 },
    "Cinematic": { contrast: 50, filter: "cinematic", fstr: 80, vignette: 35, grain: 15, sat: -5 },
    "Old photo restore": { denoise: 80, sharpen: 60, contrast: 75, clarity: 30, autowb: 60, sat: 10, dehaze: 15 },
    "Reset": {}
  };

  function sanitize(obj) {
    var out = Object.assign({}, DEFAULTS), k;
    if (!obj || typeof obj !== "object") return out;
    for (k in LIMITS) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        var v = Number(obj[k]);
        if (isFinite(v)) out[k] = clamp(Math.round(v), LIMITS[k][0], LIMITS[k][1]);
      }
    }
    if (FILTER_IDS.indexOf(obj.filter) >= 0) out.filter = obj.filter;
    if (STYLE_IDS.indexOf(obj.style) >= 0) out.style = obj.style;
    return out;
  }

  /* ---------- buffers ---------- */
  var pool = {};
  function buf(k, n) {
    if (!pool[k] || pool[k].length !== n) pool[k] = new Uint8ClampedArray(n);
    return pool[k];
  }
  function resetPool() { pool = {}; }
  function outFor(cur, n) { var a = buf("sa", n), b = buf("sb", n); return cur === a ? b : a; }

  function lum(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }

  /* Separable box blur on RGB, returns a pooled buffer (valid until the next blur). */
  function boxBlur(src, w, h, r) {
    var n = src.length, tmp = buf("bt", n), out = buf("bo", n), d = 2 * r + 1, stride = w * 4, x, y, c, i, s, o, a, b;
    for (y = 0; y < h; y++) {
      var row = y * stride;
      for (c = 0; c < 3; c++) {
        o = row + c; s = 0;
        for (i = -r; i <= r; i++) { s += src[o + (i < 0 ? 0 : (i >= w ? w - 1 : i)) * 4]; }
        for (x = 0; x < w; x++) {
          tmp[o + x * 4] = s / d; a = x + r + 1; b = x - r;
          s += src[o + (a >= w ? w - 1 : a) * 4] - src[o + (b < 0 ? 0 : b) * 4];
        }
      }
    }
    for (x = 0; x < w; x++) {
      for (c = 0; c < 3; c++) {
        o = x * 4 + c; s = 0;
        for (i = -r; i <= r; i++) { s += tmp[o + (i < 0 ? 0 : (i >= h ? h - 1 : i)) * stride]; }
        for (y = 0; y < h; y++) {
          out[o + y * stride] = s / d; a = y + r + 1; b = y - r;
          s += tmp[o + (a >= h ? h - 1 : a) * stride] - tmp[o + (b < 0 ? 0 : b) * stride];
        }
      }
    }
    return out;
  }

  /* ---------- filters (per pixel) ---------- */
  var FX = {
    cinematic: function (r, g, b, o) { var l = lum(r, g, b) / 255, rr = r + (-8 * (1 - l) + 16 * l), gg = g + (6 * (1 - l) + 4 * l), bb = b + (14 * (1 - l) - 12 * l); o[0] = 128 + (rr - 128) * 1.1; o[1] = 128 + (gg - 128) * 1.1; o[2] = 128 + (bb - 128) * 1.1; },
    vivid: function (r, g, b, o) { var y = lum(r, g, b); o[0] = y + (r - y) * 1.4; o[1] = y + (g - y) * 1.4; o[2] = y + (b - y) * 1.4; },
    film: function (r, g, b, o) { var y = lum(r, g, b); r = y + (r - y) * 0.9; g = y + (g - y) * 0.9; b = y + (b - y) * 0.9; o[0] = 26 + r * 0.9; o[1] = 20 + g * 0.9; o[2] = 14 + b * 0.9; },
    bw: function (r, g, b, o) { var y = 128 + (lum(r, g, b) - 128) * 1.15; o[0] = y; o[1] = y; o[2] = y; },
    sepia: function (r, g, b, o) { o[0] = r * 0.393 + g * 0.769 + b * 0.189; o[1] = r * 0.349 + g * 0.686 + b * 0.168; o[2] = r * 0.272 + g * 0.534 + b * 0.131; },
    cool: function (r, g, b, o) { o[0] = r - 8; o[1] = g + 2; o[2] = b + 14; },
    warm: function (r, g, b, o) { o[0] = r + 14; o[1] = g + 3; o[2] = b - 12; },
    fade: function (r, g, b, o) { var y = lum(r, g, b); r = y + (r - y) * 0.85; g = y + (g - y) * 0.85; b = y + (b - y) * 0.85; o[0] = 22 + r * 0.85; o[1] = 22 + g * 0.85; o[2] = 22 + b * 0.85; },
    noir: function (r, g, b, o) { var y = 128 + (lum(r, g, b) - 128) * 1.35; o[0] = y; o[1] = y; o[2] = y; },
    matte: function (r, g, b, o) { var y = lum(r, g, b); r = y + (r - y) * 0.85; g = y + (g - y) * 0.85; b = y + (b - y) * 0.85; o[0] = 30 + r * 0.85; o[1] = 30 + g * 0.85; o[2] = 30 + b * 0.85; },
    tealorange: function (r, g, b, o) { var l = lum(r, g, b) / 255, y = l * 255; r = y + (r - y) * 1.1; g = y + (g - y) * 1.1; b = y + (b - y) * 1.1; o[0] = r + (-20 * (1 - l) + 22 * l); o[1] = g + (8 * (1 - l) + 8 * l); o[2] = b + (18 * (1 - l) - 18 * l); },
    golden: function (r, g, b, o) { o[0] = r * 1.08 + 8; o[1] = g * 1.02 + 2; o[2] = b * 0.85; },
    cyber: function (r, g, b, o) { var l = lum(r, g, b) / 255, rr = r + (25 * (1 - l) - 15 * l), gg = g + (-10 * (1 - l) + 20 * l), bb = b + (30 * (1 - l) + 25 * l); o[0] = 128 + (rr - 128) * 1.15; o[1] = 128 + (gg - 128) * 1.15; o[2] = 128 + (bb - 128) * 1.15; },
    retro: function (r, g, b, o) { var y = lum(r, g, b); r = y + (r - y) * 0.8; g = y + (g - y) * 0.8; b = y + (b - y) * 0.8; o[0] = 40 + r * 0.85; o[1] = 26 + g * 0.85; o[2] = 34 + b * 0.75; },
    dream: function (r, g, b, o) { var y = lum(r, g, b); r = y + (r - y) * 0.9; g = y + (g - y) * 0.9; b = y + (b - y) * 0.9; o[0] = 52 + r * 0.78; o[1] = 40 + g * 0.78; o[2] = 50 + b * 0.78; },
    posterize: function (r, g, b, o) { o[0] = Math.round(r / 255 * 4) / 4 * 255; o[1] = Math.round(g / 255 * 4) / 4 * 255; o[2] = Math.round(b / 255 * 4) / 4 * 255; }
  };

  /* Neighbourhood styles run after tone mapping: cartoon, sketch, mosaic. */
  function applyStyle(dst, w, h, p) {
    var st = p.style, k = p.sstr / 100, n = dst.length, i, x, y, c;
    if (st === "none" || k <= 0) return;
    var src = buf("st", n); src.set(dst);
    if (st === "mosaic") {
      var blocks = 140 - p.sstr * 1.2, bs = Math.max(3, Math.ceil(Math.max(w, h) / blocks));
      for (y = 0; y < h; y += bs) {
        for (x = 0; x < w; x += bs) {
          var x2 = Math.min(w, x + bs), y2 = Math.min(h, y + bs), sr = 0, sg = 0, sb = 0, cnt = 0, xx, yy;
          for (yy = y; yy < y2; yy++) for (xx = x; xx < x2; xx++) { i = (yy * w + xx) * 4; sr += src[i]; sg += src[i + 1]; sb += src[i + 2]; cnt++; }
          sr /= cnt; sg /= cnt; sb /= cnt;
          for (yy = y; yy < y2; yy++) for (xx = x; xx < x2; xx++) { i = (yy * w + xx) * 4; dst[i] = sr; dst[i + 1] = sg; dst[i + 2] = sb; }
        }
      }
      return;
    }
    var bl = boxBlur(src, w, h, 1), L = new Float32Array(w * h), G = new Float32Array(w * h);
    for (i = 0; i < w * h; i++) { L[i] = lum(bl[i * 4], bl[i * 4 + 1], bl[i * 4 + 2]); G[i] = lum(src[i * 4], src[i * 4 + 1], src[i * 4 + 2]); }
    if (st === "cartoon") {
      var levels = Math.max(3, Math.round(8 - k * 4)), amt = Math.min(1, k * 1.2);
      for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
          var xl = x > 0 ? x - 1 : x, xr = x < w - 1 ? x + 1 : x, yu = y > 0 ? y - 1 : y, yd = y < h - 1 ? y + 1 : y;
          var gx = -L[yu * w + xl] - 2 * L[y * w + xl] - L[yd * w + xl] + L[yu * w + xr] + 2 * L[y * w + xr] + L[yd * w + xr];
          var gy = -L[yu * w + xl] - 2 * L[yu * w + x] - L[yu * w + xr] + L[yd * w + xl] + 2 * L[yd * w + x] + L[yd * w + xr];
          var e = clamp((Math.sqrt(gx * gx + gy * gy) - 18) / 50, 0, 1), dark = 1 - 0.9 * e;
          i = (y * w + x) * 4;
          for (c = 0; c < 3; c++) {
            var q = Math.round(src[i + c] / 255 * (levels - 1)) / (levels - 1) * 255 * dark;
            dst[i + c] = src[i + c] + (q - src[i + c]) * amt;
          }
        }
      }
    } else if (st === "sketch") {
      var am = Math.min(1, k * 1.2);
      for (i = 0; i < w * h; i++) {
        var sk = Math.min(255, G[i] * 255 / (L[i] + 1)), j = i * 4;
        for (c = 0; c < 3; c++) dst[j + c] = src[j + c] + (sk - src[j + c]) * am;
      }
    }
  }

  /* ---------- main enhancement pass ---------- */
  function enhance(img, w, h, params) {
    var p = Object.assign({}, DEFAULTS, params || {});
    if (!p._phase && (p.natural > 0 || p.calm > 0) && NATURAL) {
      // Three steps, so a preset's look survives the natural finish: fixes and light first, then the finish (it calms weak texture and
      // sets tone and colour), then the look (filter, style, vignette, grain), which the finish would otherwise smooth away.
      enhance(img, w, h, Object.assign({}, p, { filter: "none", style: "none", vignette: 0, grain: 0, natural: 0, calm: 0, _phase: 1 }));
      naturalFinish(img.data, w, h, p.natural / 100, p.calm / 100);
      if (p.filter !== "none" || p.style !== "none" || p.vignette > 0 || p.grain > 0) enhance(img, w, h, { filter: p.filter, fstr: p.fstr, style: p.style, sstr: p.sstr, vignette: p.vignette, grain: p.grain, _phase: 2 });
      return;
    }
    var dst = img.data, n = dst.length, big = Math.max(w, h), cur = dst, i, k;

    if (p.denoise > 0) {
      var bl = boxBlur(cur, w, h, Math.max(1, Math.round(big / 800))), o1 = outFor(cur, n), s = p.denoise / 100, t1 = 8 + 60 * s;
      for (i = 0; i < n; i += 4) {
        var dl = Math.abs(lum(cur[i], cur[i + 1], cur[i + 2]) - lum(bl[i], bl[i + 1], bl[i + 2])), e = dl / t1;
        if (e > 1) e = 1;
        var mix = s * (1 - e * e);
        o1[i] = cur[i] + (bl[i] - cur[i]) * mix; o1[i + 1] = cur[i + 1] + (bl[i + 1] - cur[i + 1]) * mix; o1[i + 2] = cur[i + 2] + (bl[i + 2] - cur[i + 2]) * mix; o1[i + 3] = 255;
      }
      cur = o1;
    }
    if (p.skin > 0) {
      /* Skin smoothing. A soft skin mask (so shaded skin counts and edges are feathered), a blur that only averages
         skin pixels (so hair and background do not bleed in), and an edge guard that keeps eyes, lips and brows sharp.
         A little texture is kept even at full strength so the result does not look like plastic. */
      var kk = p.skin / 100, rs = Math.max(3, Math.round(big / 150)), pm = buf("skp", n), mk = buf("skm", n), sk = new Float32Array(w * h), q = 0;
      var smooth01 = function (v) { return v <= 0 ? 0 : (v >= 1 ? 1 : v * v * (3 - 2 * v)); };
      for (i = 0; i < n; i += 4, q++) {
        var r = cur[i], g = cur[i + 1], b = cur[i + 2], lm = lum(r, g, b);
        var cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
        var mc = Math.min((cb - 72) / 8, (132 - cb) / 8, (cr - 128) / 8, (178 - cr) / 8), ms = smooth01(mc) * smooth01((lm - 22) / 26) * (r >= g ? 1 : 0.3);
        sk[q] = ms;
        pm[i] = r * ms; pm[i + 1] = g * ms; pm[i + 2] = b * ms; pm[i + 3] = 255;
        var mv = ms * 255; mk[i] = mv; mk[i + 1] = mv; mk[i + 2] = mv; mk[i + 3] = 255;
      }
      var b1 = boxBlur(pm, w, h, rs), bcol = buf("skb", n); bcol.set(b1);
      var b2 = boxBlur(mk, w, h, rs), o2 = outFor(cur, n), tol = 16 + 40 * kk, amax = 0.9 * kk;
      q = 0;
      for (i = 0; i < n; i += 4, q++) {
        var r2 = cur[i], g2 = cur[i + 1], b3 = cur[i + 2], m2 = b2[i] / 255, ms2 = sk[q];
        if (ms2 < 0.02 || m2 < 0.08) { o2[i] = r2; o2[i + 1] = g2; o2[i + 2] = b3; o2[i + 3] = 255; continue; }
        var sr = bcol[i] / m2, sg = bcol[i + 1] / m2, sb = bcol[i + 2] / m2;
        var skd = Math.abs(lum(r2, g2, b3) - lum(sr, sg, sb)), ed = skd >= tol ? 0 : 1 - (skd / tol) * (skd / tol), a = ms2 * ed * amax * smooth01(m2 * 1.5);
        o2[i] = r2 + (sr - r2) * a; o2[i + 1] = g2 + (sg - g2) * a; o2[i + 2] = b3 + (sb - b3) * a; o2[i + 3] = 255;
      }
      cur = o2;
    }
    if (p.sharpen > 0) {
      var bh = boxBlur(cur, w, h, Math.max(1, Math.round(big / 1100))), o3 = outFor(cur, n), am = p.sharpen / 100 * 1.8;
      for (i = 0; i < n; i += 4) {
        for (k = 0; k < 3; k++) {
          var df = cur[i + k] - bh[i + k];
          o3[i + k] = cur[i + k] + (Math.abs(df) < 2 ? 0 : df * am);
        }
        o3[i + 3] = 255;
      }
      cur = o3;
    }
    if (p.clarity > 0) {
      var bc = boxBlur(cur, w, h, Math.max(4, Math.round(big / 60))), o4 = outFor(cur, n), ca = p.clarity / 100 * 0.9;
      for (i = 0; i < n; i += 4) {
        for (k = 0; k < 3; k++) { o4[i + k] = cur[i + k] + (cur[i + k] - bc[i + k]) * ca; }
        o4[i + 3] = 255;
      }
      cur = o4;
    }
    if (p.glow > 0) {
      var bg = boxBlur(cur, w, h, Math.max(3, Math.round(big / 70))), o5 = outFor(cur, n), gm = p.glow / 100 * 0.45;
      for (i = 0; i < n; i += 4) {
        for (k = 0; k < 3; k++) {
          var sc = 255 - (255 - cur[i + k]) * (255 - bg[i + k]) / 255;
          o5[i + k] = cur[i + k] + (sc - cur[i + k]) * gm;
        }
        o5[i + 3] = 255;
      }
      cur = o5;
    }
    if (p.tilt > 0) {
      var bt = boxBlur(cur, w, h, Math.max(3, Math.round(big / 40))), o6 = outFor(cur, n), tk = p.tilt / 100, tx = 0, ty = 0, hx = w / 2, hy = h / 2;
      for (i = 0; i < n; i += 4) {
        var nx = (tx - hx) / hx, ny = (ty - hy) / hy, dd = Math.sqrt(nx * nx * 0.8 + ny * ny * 1.25), tt = clamp((dd - 0.35) / 0.5, 0, 1), mm = tt * tt * (3 - 2 * tt) * tk;
        o6[i] = cur[i] + (bt[i] - cur[i]) * mm; o6[i + 1] = cur[i + 1] + (bt[i + 1] - cur[i + 1]) * mm; o6[i + 2] = cur[i + 2] + (bt[i + 2] - cur[i + 2]) * mm; o6[i + 3] = 255;
        tx++; if (tx === w) { tx = 0; ty++; }
      }
      cur = o6;
    }

    var hist = new Uint32Array(256), step = Math.max(1, Math.floor(n / 4 / 60000)) * 4, cnt = 0, sR = 0, sG = 0, sB = 0;
    for (i = 0; i < n; i += step) {
      hist[clamp(lum(cur[i], cur[i + 1], cur[i + 2]) | 0, 0, 255)]++; cnt++;
      sR += cur[i]; sG += cur[i + 1]; sB += cur[i + 2];
    }
    var acc = 0, lo = 0, hi = 255, v;
    for (v = 0; v < 256; v++) { acc += hist[v]; if (acc >= cnt * 0.005) { lo = v; break; } }
    acc = 0;
    for (v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= cnt * 0.005) { hi = v; break; } }
    var sc2 = p.contrast / 100, lo2 = lo * sc2, hi2 = hi + (255 - hi) * (1 - sc2);
    if (hi2 - lo2 < 40) hi2 = lo2 + 40;
    var scale = 255 / (hi2 - lo2), br = p.bright * 1.5, sat = 1 + p.sat / 50, wr = p.warm * 0.6;
    var shd = p.shadows * 1.2, hil = p.highlights * 1.2, dh = p.dehaze / 100 * 0.6, gr = p.grain * 0.6;
    var gR = 1, gG = 1, gB = 1;
    if (p.autowb > 0 && cnt > 0 && sR > 0 && sG > 0 && sB > 0) {
      var mR = sR / cnt, mG = sG / cnt, mB = sB / cnt, gm2 = (mR + mG + mB) / 3, ak = p.autowb / 100;
      gR = 1 + (clamp(gm2 / mR, 0.7, 1.4) - 1) * ak; gG = 1 + (clamp(gm2 / mG, 0.7, 1.4) - 1) * ak; gB = 1 + (clamp(gm2 / mB, 0.7, 1.4) - 1) * ak;
    }
    var fxf = FX[p.filter] || null, fs = fxf ? p.fstr / 100 : 0, fo = [0, 0, 0];
    var vg = p.vignette / 100, cx = w / 2, cy = h / 2, maxd = Math.sqrt(cx * cx + cy * cy), px = 0, py = 0;
    for (i = 0; i < n; i += 4) {
      var R = (cur[i] * gR - lo2) * scale + br, G = (cur[i + 1] * gG - lo2) * scale + br, B = (cur[i + 2] * gB - lo2) * scale + br;
      if (dh > 0) {
        var mn = Math.min(R, G, B), sub = mn * dh, dv = 1 - dh * 0.6;
        R = (R - sub) / dv; G = (G - sub) / dv; B = (B - sub) / dv;
      }
      var gy = lum(R, G, B);
      if (shd !== 0 || hil !== 0) {
        var lt = clamp(gy / 255, 0, 1), add = shd * (1 - lt) * (1 - lt) + hil * lt * lt;
        R += add; G += add; B += add; gy += add;
      }
      R = gy + (R - gy) * sat + wr; G = gy + (G - gy) * sat; B = gy + (B - gy) * sat - wr;
      if (fs > 0) {
        fxf(R, G, B, fo);
        R += (fo[0] - R) * fs; G += (fo[1] - G) * fs; B += (fo[2] - B) * fs;
      }
      if (vg > 0) {
        var dx = px - cx, dy = py - cy, ddv = Math.sqrt(dx * dx + dy * dy) / maxd, f = 1 - vg * 0.85 * ddv * ddv * ddv;
        R *= f; G *= f; B *= f;
      }
      if (gr > 0) { var nz = (Math.random() - 0.5) * gr; R += nz; G += nz; B += nz; }
      dst[i] = R; dst[i + 1] = G; dst[i + 2] = B;
      px++; if (px === w) { px = 0; py++; }
    }
    if (p.style !== "none" && p.sstr > 0) applyStyle(dst, w, h, p);
  }


  /* ---------- natural finish ----------
     A learned finishing stage. Its numbers were fitted (ai/train/fit_natural.js) so that Lumio's output matches the statistics of a
     reference result of the same photo: how much fine detail survives in each frequency band (a shrinkage curve per band, so weak,
     noise-like texture is calmed while real edges stay), the tone curve, and the colour saturation. "calm" controls the detail part,
     "natural" the tone and colour part. The bands scale with image size, so HD, 2K, 4K, 8K and AI enhance get the same look. */
  var NATURAL = /*NATURAL_PARAMS*/{"sigmas":[0.8,1.6,3.2,6.4],"curves":[{"x":[0,0.09,0.286,0.511,0.781,1.108,1.513,2.089,3.034,4.568,7.188,12.337,27.76],"y":[0,0.09,0.286,0.511,0.781,1.108,1.513,2.089,3.034,4.568,6.195,8.322,15.506]},{"x":[0,0.08,0.261,0.475,0.734,1.047,1.438,1.949,2.666,3.73,5.445,8.622,18.337],"y":[0,0.08,0.261,0.475,0.734,1.047,1.438,1.949,2.528,3.069,3.98,5.696,12.812]},{"x":[0,0.127,0.397,0.694,1.039,1.45,1.953,2.589,3.445,4.678,6.587,10.01,20.977],"y":[0,0.127,0.397,0.694,1.039,1.45,1.807,2.201,2.774,3.624,4.938,7.407,17.814]},{"x":[0,0.169,0.517,0.89,1.304,1.788,2.383,3.132,4.105,5.4,7.328,10.687,20.738],"y":[0,0.169,0.517,0.89,1.304,1.74,2.216,2.808,3.596,4.655,6.235,9.103,19.59]}],"tone":[0,2.04,2.93,2.93,2.52,2.08,1.65,1.12,0.46,-0.39,-1.41,-2.4,-3.02,-2.9,-2.02,-0.94,0],"chroma":0.898}/*END_NATURAL_PARAMS*/;
  function boxesForGauss(sigma, n) {
    var wi = Math.sqrt(12 * sigma * sigma / n + 1), wl = Math.floor(wi), wu, m, out = [], i;
    if (wl % 2 === 0) wl--; wu = wl + 2;
    m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
    for (i = 0; i < n; i++) out.push(((i < m ? wl : wu) - 1) / 2);
    return out;
  }
  function boxH(a, b, w, h, r) {
    var d = 2 * r + 1, x, y, i, s, row;
    for (y = 0; y < h; y++) {
      row = y * w; s = 0;
      for (i = -r; i <= r; i++) s += a[row + (i < 0 ? 0 : (i >= w ? w - 1 : i))];
      for (x = 0; x < w; x++) { b[row + x] = s / d; s += a[row + (x + r + 1 >= w ? w - 1 : x + r + 1)] - a[row + (x - r < 0 ? 0 : x - r)]; }
    }
  }
  function boxV(a, b, w, h, r) {
    var d = 2 * r + 1, x, y, i, s;
    for (x = 0; x < w; x++) {
      s = 0;
      for (i = -r; i <= r; i++) s += a[(i < 0 ? 0 : (i >= h ? h - 1 : i)) * w + x];
      for (y = 0; y < h; y++) { b[y * w + x] = s / d; s += a[(y + r + 1 >= h ? h - 1 : y + r + 1) * w + x] - a[(y - r < 0 ? 0 : y - r) * w + x]; }
    }
  }
  /* Gaussian blur of a float plane (three box passes). dst gets the result; tmp is scratch. */
  function gaussF(src, dst, tmp, w, h, sigma) {
    var boxes = boxesForGauss(Math.max(0.5, sigma), 3), k;
    dst.set(src);
    for (k = 0; k < 3; k++) { boxH(dst, tmp, w, h, boxes[k]); boxV(tmp, dst, w, h, boxes[k]); }
  }
  /* Split a luma plane into detail bands (fine to coarse) plus a low-frequency rest. visit(k, band) gets each band; returns the low plane. */
  function decompose(Y, w, h, sigmas, visit) {
    var n = w * h, prev = new Float32Array(Y), cur = new Float32Array(n), tmp = new Float32Array(n), done = 0, k, i, t;
    for (k = 0; k < sigmas.length; k++) {
      gaussF(prev, cur, tmp, w, h, Math.sqrt(Math.max(1e-6, sigmas[k] * sigmas[k] - done * done)));
      for (i = 0; i < n; i++) tmp[i] = prev[i] - cur[i];
      visit(k, tmp);
      t = prev; prev = cur; cur = t; done = sigmas[k];
    }
    return prev;
  }
  function curveAt(c, m) {
    var x = c.x, y = c.y, last = x.length - 1, i;
    if (m >= x[last]) return m * (y[last] / x[last]);
    for (i = 1; i <= last; i++) if (m <= x[i]) return y[i - 1] + (y[i] - y[i - 1]) * (m - x[i - 1]) / (x[i] - x[i - 1]);
    return m;
  }
  function toneDelta(t, y01) {
    var f = clamp(y01, 0, 1) * (t.length - 1), i = Math.min(t.length - 2, Math.floor(f));
    return t[i] + (t[i + 1] - t[i]) * (f - i);
  }
  function sizeScale(w, h) { return Math.max(0.6, Math.min(w, h) / 1080); }
  function naturalFinish(dst, w, h, nat, calm) {
    var n = w * h, Y = new Float32Array(n), i, sc = sizeScale(w, h), P = NATURAL;
    for (i = 0; i < n; i++) Y[i] = lum(dst[i * 4], dst[i * 4 + 1], dst[i * 4 + 2]);
    var out = Y;
    if (calm > 0) {
      var acc = new Float32Array(n), sig = P.sigmas.map(function (s) { return s * sc; });
      var low = decompose(Y, w, h, sig, function (k, band) {
        var c = P.curves[k], j, v, m, r;
        for (j = 0; j < n; j++) { v = band[j]; m = v < 0 ? -v : v; r = curveAt(c, m); acc[j] += v + ((v < 0 ? -r : r) - v) * calm; }
      });
      for (i = 0; i < n; i++) acc[i] += low[i];
      out = acc;
    }
    var gc = 1 + (P.chroma - 1) * nat, tn = nat;
    for (i = 0; i < n; i++) {
      var q = i * 4, y0 = Y[i], y1 = out[i], dR = dst[q] - y0, dG = dst[q + 1] - y0, dB = dst[q + 2] - y0;
      if (tn > 0) y1 += toneDelta(P.tone, y1 / 255) * tn;
      dst[q] = y1 + dR * gc; dst[q + 1] = y1 + dG * gc; dst[q + 2] = y1 + dB * gc;
    }
  }

  /* ---------- object removal: onion-peel fill, then relaxation ---------- */
  function inpaintRegion(id, w, h, mask) {
    var d = id.data, n = w * h, known = new Uint8Array(n), i, x, y, dx, dy, xx, yy, j, q;
    for (i = 0; i < n; i++) known[i] = mask[i] ? 0 : 1;
    var list = [];
    for (i = 0; i < n; i++) if (!known[i]) list.push(i);
    var guard = w + h + 10;
    while (list.length && guard-- > 0) {
      var fi = [], fr = [], fg = [], fb = [], rest = [];
      for (q = 0; q < list.length; q++) {
        i = list[q]; x = i % w; y = (i - x) / w;
        var sr = 0, sg = 0, sb = 0, sw = 0;
        for (dy = -1; dy <= 1; dy++) {
          yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            xx = x + dx; if (xx < 0 || xx >= w) continue;
            j = yy * w + xx;
            if (known[j]) { var wt = (dx && dy) ? 0.7071 : 1; sr += d[j * 4] * wt; sg += d[j * 4 + 1] * wt; sb += d[j * 4 + 2] * wt; sw += wt; }
          }
        }
        if (sw > 0) { fi.push(i); fr.push(sr / sw); fg.push(sg / sw); fb.push(sb / sw); } else rest.push(i);
      }
      if (!fi.length) break;
      for (q = 0; q < fi.length; q++) { i = fi[q]; d[i * 4] = fr[q]; d[i * 4 + 1] = fg[q]; d[i * 4 + 2] = fb[q]; known[i] = 1; }
      list = rest;
    }
    for (var pass = 0; pass < 8; pass++) {
      for (i = 0; i < n; i++) {
        if (!mask[i]) continue;
        x = i % w; y = (i - x) / w;
        var ar = 0, ag = 0, ab = 0, c = 0;
        if (x > 0) { j = i - 1; ar += d[j * 4]; ag += d[j * 4 + 1]; ab += d[j * 4 + 2]; c++; }
        if (x < w - 1) { j = i + 1; ar += d[j * 4]; ag += d[j * 4 + 1]; ab += d[j * 4 + 2]; c++; }
        if (y > 0) { j = i - w; ar += d[j * 4]; ag += d[j * 4 + 1]; ab += d[j * 4 + 2]; c++; }
        if (y < h - 1) { j = i + w; ar += d[j * 4]; ag += d[j * 4 + 1]; ab += d[j * 4 + 2]; c++; }
        if (c) { d[i * 4] = ar / c; d[i * 4 + 1] = ag / c; d[i * 4 + 2] = ab / c; }
      }
    }
  }

  /* ---------- background cutout: contiguous colour flood fill ---------- */
  function floodFill(d, W, H, sx, sy, thr) {
    var vis = new Uint8Array(W * H), stack = new Int32Array(W * H), sp = 0, s = sy * W + sx, si = s * 4;
    var sr = d[si], sg = d[si + 1], sb = d[si + 2], t2 = thr * thr, k;
    vis[s] = 1; stack[sp++] = s;
    while (sp > 0) {
      var p = stack[--sp], x = p % W, y = (p - x) / W;
      for (k = 0; k < 4; k++) {
        var nx = x + (k === 0 ? 1 : (k === 1 ? -1 : 0)), ny = y + (k === 2 ? 1 : (k === 3 ? -1 : 0));
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        var q = ny * W + nx;
        if (vis[q]) continue;
        var qi = q * 4, dr = d[qi] - sr, dg = d[qi + 1] - sg, db = d[qi + 2] - sb;
        if (dr * dr + dg * dg + db * db <= t2) { vis[q] = 1; stack[sp++] = q; }
      }
    }
    return vis;
  }
  /* Apply a flood-fill result to RGBA data: transparent inside, soft edge ring. Returns removed pixel count. */
  function applyCutout(d, W, H, vis) {
    var n = W * H, i, x, y, count = 0;
    for (i = 0; i < n; i++) if (vis[i]) count++;
    for (i = 0; i < n; i++) { if (vis[i]) d[i * 4 + 3] = 0; }
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        i = y * W + x;
        if (vis[i]) continue;
        if ((x > 0 && vis[i - 1]) || (x < W - 1 && vis[i + 1]) || (y > 0 && vis[i - W]) || (y < H - 1 && vis[i + W])) d[i * 4 + 3] = Math.min(d[i * 4 + 3], 150);
      }
    }
    return count;
  }

  /* ---------- brush retouch: masked color work and liquify ---------- */
  /* mask: Uint8Array (W*H), 0 to 255 soft coverage. amt: 0 to 100. Works in place on RGBA data. */
  function whitenMasked(d, W, H, mask, amt) {
    var n = W * H, i, p, k, l, w, desat, lift, r, g, b;
    for (i = 0; i < n; i++) {
      if (!mask[i]) continue;
      p = i * 4; r = d[p]; g = d[p + 1]; b = d[p + 2]; l = lum(r, g, b);
      k = (mask[i] / 255) * (amt / 100); w = clamp((l - 70) / 80, 0, 1);
      desat = k * 0.75 * w; lift = k * 46 * w * (1 - l / 255);
      d[p] = r + (l - r) * desat + lift; d[p + 1] = g + (l - g) * desat + lift; d[p + 2] = b + (l - b) * desat + lift;
    }
  }
  /* Recolor keeps the original light and dark detail and moves the hue toward rgb. */
  function recolorMasked(d, W, H, mask, rgb, amt) {
    var n = W * H, tl = Math.max(1, lum(rgb[0], rgb[1], rgb[2])), i, p, k, s, l;
    for (i = 0; i < n; i++) {
      if (!mask[i]) continue;
      p = i * 4; l = lum(d[p], d[p + 1], d[p + 2]); s = l / tl; k = (mask[i] / 255) * (amt / 100);
      d[p] += (clamp(rgb[0] * s, 0, 255) - d[p]) * k; d[p + 1] += (clamp(rgb[1] * s, 0, 255) - d[p + 1]) * k; d[p + 2] += (clamp(rgb[2] * s, 0, 255) - d[p + 2]) * k;
    }
  }
  /* One liquify dab at (cx, cy). mode: "push" moves pixels along (dx, dy), "pinch" shrinks, "bloat" enlarges. k: 0 to 1. */
  function liquify(d, W, H, cx, cy, r, mode, dx, dy, k) {
    var lim = r * 0.6, m = Math.sqrt(dx * dx + dy * dy);
    if (m > lim) { dx *= lim / m; dy *= lim / m; }
    var pad = Math.ceil(r * 0.7) + 2;
    var ex0 = Math.max(0, Math.floor(cx - r) - pad), ey0 = Math.max(0, Math.floor(cy - r) - pad), ex1 = Math.min(W - 1, Math.ceil(cx + r) + pad), ey1 = Math.min(H - 1, Math.ceil(cy + r) + pad);
    var ew = ex1 - ex0 + 1, eh = ey1 - ey0 + 1, src = new Uint8ClampedArray(ew * eh * 4), x, y, q;
    for (y = 0; y < eh; y++) for (x = 0; x < ew; x++) { q = ((y + ey0) * W + x + ex0) * 4; var o = (y * ew + x) * 4; src[o] = d[q]; src[o + 1] = d[q + 1]; src[o + 2] = d[q + 2]; src[o + 3] = d[q + 3]; }
    function sample(sx, sy, c) {
      sx = clamp(sx - ex0, 0, ew - 1.001); sy = clamp(sy - ey0, 0, eh - 1.001);
      var x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0, a = (y0 * ew + x0) * 4 + c, b2 = a + 4, c2 = a + ew * 4, d2 = c2 + 4;
      return src[a] * (1 - fx) * (1 - fy) + src[b2] * fx * (1 - fy) + src[c2] * (1 - fx) * fy + src[d2] * fx * fy;
    }
    var bx0 = Math.max(0, Math.floor(cx - r)), by0 = Math.max(0, Math.floor(cy - r)), bx1 = Math.min(W - 1, Math.ceil(cx + r)), by1 = Math.min(H - 1, Math.ceil(cy + r));
    for (y = by0; y <= by1; y++) for (x = bx0; x <= bx1; x++) {
      var ax = x - cx, ay = y - cy, dist = Math.sqrt(ax * ax + ay * ay);
      if (dist >= r) continue;
      var t = 1 - dist / r, wgt = t * t * (3 - 2 * t) * k, sx, sy;
      if (mode === "pinch") { sx = x + ax * wgt * 0.5; sy = y + ay * wgt * 0.5; }
      else if (mode === "bloat") { sx = x - ax * wgt * 0.5; sy = y - ay * wgt * 0.5; }
      else { sx = x - dx * wgt; sy = y - dy * wgt; }
      q = (y * W + x) * 4; d[q] = sample(sx, sy, 0); d[q + 1] = sample(sx, sy, 1); d[q + 2] = sample(sx, sy, 2); d[q + 3] = sample(sx, sy, 3);
    }
  }
  /* Soften a 0/1 mask into 0 to 255 coverage with a box blur of the given radius (2 passes). */
  function softMask(mask, W, H, r) {
    var a = new Float32Array(W * H), b = new Float32Array(W * H), i, x, y, s, d = 2 * r + 1;
    for (i = 0; i < a.length; i++) a[i] = mask[i] ? 255 : 0;
    if (r < 1) return Uint8Array.from(a);
    for (var pass = 0; pass < 2; pass++) {
      for (y = 0; y < H; y++) { s = 0; for (x = -r; x <= r; x++) s += a[y * W + clamp(x, 0, W - 1)]; for (x = 0; x < W; x++) { b[y * W + x] = s / d; s += a[y * W + clamp(x + r + 1, 0, W - 1)] - a[y * W + clamp(x - r, 0, W - 1)]; } }
      for (x = 0; x < W; x++) { s = 0; for (y = -r; y <= r; y++) s += b[clamp(y, 0, H - 1) * W + x]; for (y = 0; y < H; y++) { a[y * W + x] = s / d; s += b[clamp(y + r + 1, 0, H - 1) * W + x] - b[clamp(y - r, 0, H - 1) * W + x]; } }
    }
    var out = new Uint8Array(W * H); for (i = 0; i < out.length; i++) out[i] = a[i];
    return out;
  }
  /* ---------- AI enhance: measure the image, then choose settings from the measurements ---------- */
  function pct(arr, q) { var a = Array.prototype.slice.call(arr).sort(function (x, y) { return x - y; }); return a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : 0; }
  function analyze(d, W, H) {
    // Work on a contiguous central crop (up to 320 x 320) so neighbor statistics stay meaningful.
    var cw = Math.min(W, 320), ch = Math.min(H, 320), x0 = Math.floor((W - cw) / 2), y0 = Math.floor((H - ch) / 2);
    var L = new Float32Array(cw * ch), hist = new Uint32Array(256), x, y, i, p, sr = 0, sg = 0, sb = 0, sat = 0, n = cw * ch;
    for (y = 0; y < ch; y++) for (x = 0; x < cw; x++) {
      p = ((y + y0) * W + x + x0) * 4; var r = d[p], g = d[p + 1], b = d[p + 2], l = lum(r, g, b);
      L[y * cw + x] = l; hist[Math.min(255, Math.round(l))]++; sr += r; sg += g; sb += b;
      var mx = Math.max(r, g, b); sat += mx ? (mx - Math.min(r, g, b)) / mx : 0;
    }
    function hp(q) { var t = q * n, c = 0, k; for (k = 0; k < 256; k++) { c += hist[k]; if (c >= t) return k; } return 255; }
    var res = [], grad = [];
    for (y = 1; y < ch - 1; y++) for (x = 1; x < cw - 1; x++) {
      i = y * cw + x; var c0 = L[i], avg = (L[i - 1] + L[i + 1] + L[i - cw] + L[i + cw]) / 4;
      res.push(Math.abs(c0 - avg)); grad.push(Math.abs(L[i + 1] - L[i - 1]) + Math.abs(L[i + cw] - L[i - cw]));
    }
    var noise = res.length ? pct(res, 0.3) / 0.385 / 1.118 : 0, edge = grad.length ? pct(grad, 0.9) : 0;
    // JPEG blockiness: pixel steps across the 8-pixel grid compared with steps inside it (grid position uses real image coordinates).
    var bs = 0, bn = 0, is = 0, inn = 0, df;
    for (y = 0; y < ch; y++) for (x = 0; x < cw - 1; x++) {
      df = Math.min(12, Math.abs(L[y * cw + x + 1] - L[y * cw + x])); // JPEG steps are small; clipping stops real edges (checkerboards, text) from counting
      if (((x0 + x) & 7) === 7) { bs += df; bn++; } else { is += df; inn++; }
    }
    var block = bn && inn && is / inn > 0.4 ? Math.max(0, (bs / bn) / (is / inn) - 1) : 0; // flat-inside images have no blocks to measure
    // Flat-area residual: spread of luminance around its 5x5 average, measured only where the image is smoothest.
    // Unlike the 4-neighbor estimate above, this still sees noise after JPEG compression has smeared it.
    var fg = [], fr = [], j, k2, sum;
    for (y = 3; y < ch - 3; y++) for (x = 3; x < cw - 3; x++) {
      sum = 0; for (j = -2; j <= 2; j++) for (k2 = -2; k2 <= 2; k2++) sum += L[(y + j) * cw + x + k2];
      i = y * cw + x; fr.push(L[i] - sum / 25);
      fg.push(Math.abs(L[i + 2] - L[i - 2]) + Math.abs(L[i + 2 * cw] - L[i - 2 * cw]));
    }
    var flat = 0;
    if (fg.length) {
      var thr = Math.min(pct(fg, 0.3), 40), fs2 = 0, fn = 0; // the cap keeps hard edges out of the 'flat' set
      for (i = 0; i < fg.length; i++) if (fg[i] <= thr) { fs2 += fr[i] * fr[i]; fn++; }
      flat = fn >= 50 ? Math.sqrt(fs2 / fn) : 0;
    }
    var means = [sr / n, sg / n, sb / n], mn = Math.max(1, Math.min(means[0], means[1], means[2])), mxc = Math.max(means[0], means[1], means[2]);
    return {
      meanL: (means[0] * 0.299 + means[1] * 0.587 + means[2] * 0.114), p1: hp(0.01), p99: hp(0.99),
      clipLow: hist[0] / n + hist[1] / n + hist[2] / n, clipHigh: (hist[253] + hist[254] + hist[255]) / n,
      noise: noise, edge: edge, block: block, flat: flat, cast: mxc / mn - 1, sat: sat / n
    };
  }
  /* Returns { settings, notes }. mode "video" skips settings that only make sense for stills. */
  function smartParams(m) {
    var s = {}, notes = [], spread = m.p99 - m.p1, blur = clamp(1 - m.edge / 45, 0, 1);
    // Damage = grain the old 4-neighbor estimate sees, grain left in flat areas, plus JPEG blockiness.
    var dmg = clamp(Math.max(m.noise * 5, ((m.flat || 0) - 2) * 14) + (m.block || 0) * 60, 0, 85);
    // Capped on purpose: the classical denoiser cannot tell fine texture (fabric, hair) from grain, so past this it smears detail.
    s.denoise = Math.round(Math.min(dmg * 0.75, 55)); if (dmg >= 25) notes.push("noisy"); if ((m.block || 0) > 0.15) notes.push("compressed");
    s.sharpen = Math.round(clamp(30 + blur * 50 - dmg * 0.45, 15, 80)); if (blur > 0.55) notes.push("soft");
    s.contrast = Math.round(clamp((235 - spread) / 1.6, 0, 80)); if (spread < 140) notes.push("flat");
    s.clarity = Math.round(clamp(blur * 35 + (spread < 150 ? 12 : 0), 0, 45));
    var haze = m.p1 > 35 && spread < 170; s.dehaze = haze ? Math.round(clamp((m.p1 - 20) * 1.2, 0, 60)) : 0; if (haze) notes.push("hazy");
    // Gray-world white balance is only trustworthy for a strong cast. A green park or a yellow dress also tips the channel means, and correcting that turns skin pink.
    s.autowb = Math.round(clamp((m.cast - 0.35) * 250, 0, 70)); if (s.autowb >= 25) notes.push("color cast");
    s.bright = m.meanL < 95 ? Math.round(clamp((100 - m.meanL) * 0.4, 0, 25)) : (m.meanL > 170 ? -Math.round(clamp((m.meanL - 165) * 0.3, 0, 15)) : 0);
    if (m.meanL < 80) notes.push("dark"); if (m.meanL > 185) notes.push("bright");
    s.shadows = m.meanL < 110 ? Math.round(clamp((110 - m.meanL) * 0.3, 0, 25)) : 0;
    s.highlights = m.clipHigh > 0.04 ? -Math.round(clamp(m.clipHigh * 200, 0, 30)) : 0;
    s.sat = m.sat < 0.25 ? Math.round(clamp((0.3 - m.sat) * 80, 0, 20)) : (m.sat > 0.6 ? -8 : 4);
    return { settings: sanitize(s), notes: notes };
  }
  function aiEnhance(d, W, H) { var m = analyze(d, W, H), r = smartParams(m); r.metrics = m; return r; }

  /* Block matching: find (dx, dy) so that cur(x, y) is closest to prev(x + dx, y + dy). Arrays are W*H gray values. */
  function estimateShift(prev, cur, W, H, R, margin) {
    var best = 1e12, bx = 0, by = 0, dx, dy, x, y, sad;
    for (dy = -R; dy <= R; dy++) for (dx = -R; dx <= R; dx++) {
      sad = 0;
      for (y = margin; y < H - margin; y++) for (x = margin; x < W - margin; x++) sad += Math.abs(cur[y * W + x] - prev[(y + dy) * W + x + dx]);
      sad += (Math.abs(dx) + Math.abs(dy)) * 6;
      if (sad < best) { best = sad; bx = dx; by = dy; }
    }
    return { dx: bx, dy: by };
  }
  /* Split a script into timed captions spread over [start, end] in proportion to text length. */
  function scriptToCaps(text, start, end) {
    var parts = String(text).split(/\r?\n+/).map(function (l) { return l.trim(); }).filter(Boolean), lines = [];
    parts.forEach(function (p) {
      (p.match(/[^.!?]+[.!?]*/g) || [p]).forEach(function (s) {
        s = s.trim(); while (s.length > 42) { var cut = s.lastIndexOf(" ", 42); if (cut < 12) cut = 42; lines.push(s.slice(0, cut).trim()); s = s.slice(cut).trim(); }
        if (s) lines.push(s);
      });
    });
    var total = lines.reduce(function (n, l) { return n + l.length + 8; }, 0), t = start, span = Math.max(0.5, end - start), out = [];
    lines.forEach(function (l) { var dur = span * (l.length + 8) / total; out.push({ a: t, b: t + dur, t: l }); t += dur; });
    return out;
  }
  function capsToText(caps) { return caps.map(function (c) { return fmt(c.a) + "-" + fmt(c.b) + " " + c.t; }).join("\n"); }

  /* ---------- captions and time ---------- */
  function parseTime(s) {
    var m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s);
    if (m) return (+m[1]) * 60 + (+m[2]);
    var f = parseFloat(s); return isNaN(f) ? NaN : f;
  }
  function parseCaps(txt) {
    var out = [];
    String(txt).split(/\r?\n/).forEach(function (line) {
      var m = /^\s*([\d:.]+)\s*-\s*([\d:.]+)\s+(.+?)\s*$/.exec(line);
      if (!m) return;
      var a = parseTime(m[1]), b = parseTime(m[2]);
      if (isNaN(a) || isNaN(b) || b <= a) return;
      out.push({ a: a, b: b, t: m[3] });
    });
    return out;
  }
  function fmt(t) { t = Math.max(0, t || 0); var m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ":" + (s < 10 ? "0" : "") + s; }

  return {
    DEFAULTS: DEFAULTS, LIMITS: LIMITS, PRESETS: PRESETS, FILTER_IDS: FILTER_IDS, STYLE_IDS: STYLE_IDS,
    sanitize: sanitize, enhance: enhance, inpaintRegion: inpaintRegion, floodFill: floodFill, applyCutout: applyCutout,
    whitenMasked: whitenMasked, recolorMasked: recolorMasked, liquify: liquify, softMask: softMask, scriptToCaps: scriptToCaps, estimateShift: estimateShift, analyze: analyze, smartParams: smartParams, aiEnhance: aiEnhance, naturalKit: { decompose: decompose, sizeScale: sizeScale, curveAt: curveAt, toneDelta: toneDelta, lum: lum, params: function () { return NATURAL; } }, capsToText: capsToText,
    parseTime: parseTime, parseCaps: parseCaps, fmt: fmt, resetPool: resetPool, clamp: clamp
  };
});

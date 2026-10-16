"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../public/js/engine.js");
const F = require("../public/js/features.js");

function solid(w, h, r, g, b, a) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a === undefined ? 255 : a; }
  return { data: d };
}
const noNaN = (d) => { for (let i = 0; i < d.length; i++) if (Number.isNaN(d[i])) return false; return true; };

test("neutral settings leave pixels unchanged", () => {
  const img = solid(40, 30, 50, 80, 120);
  for (let i = 0; i < img.data.length; i += 4) img.data[i] = 50 + ((i / 4) % 40);
  const copy = new Uint8ClampedArray(img.data);
  E.enhance(img, 40, 30, {});
  let max = 0;
  for (let i = 0; i < copy.length; i++) max = Math.max(max, Math.abs(copy[i] - img.data[i]));
  assert.ok(max <= 1, "max diff " + max);
});

test("every preset runs without NaN and keeps alpha", () => {
  Object.keys(E.PRESETS).forEach((name) => {
    const img = solid(50, 40, 120, 90, 60, 200);
    for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 40; img.data[i] += n; img.data[i + 1] += n; }
    E.enhance(img, 50, 40, E.sanitize(E.PRESETS[name]));
    assert.ok(noNaN(img.data), name);
    assert.equal(img.data[3], 200, name + " alpha");
  });
});

test("every filter and style produces valid output", () => {
  E.FILTER_IDS.concat([]).forEach((f) => {
    const img = solid(30, 30, 140, 100, 60);
    E.enhance(img, 30, 30, { filter: f, fstr: 100 });
    assert.ok(noNaN(img.data), f);
  });
  E.STYLE_IDS.forEach((s) => {
    const img = solid(40, 40, 140, 100, 60);
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) { const i = (y * 40 + x) * 4; img.data[i] = 20; img.data[i + 1] = 20; img.data[i + 2] = 200; }
    E.enhance(img, 40, 40, { style: s, sstr: 80 });
    assert.ok(noNaN(img.data), s);
  });
});

test("features and filters line up with the engine", () => {
  F.FILTERS.forEach((f) => assert.ok(E.FILTER_IDS.includes(f.id), "filter " + f.id));
  E.FILTER_IDS.forEach((id) => assert.ok(F.FILTERS.some((f) => f.id === id), "registry has " + id));
  F.STYLES.forEach((s) => assert.ok(E.STYLE_IDS.includes(s.id), "style " + s.id));
  assert.equal(F.settingsNeedVip({ filter: "noir" }), true);
  assert.equal(F.settingsNeedVip({ filter: "sepia" }), false);
  assert.equal(F.settingsNeedVip({ style: "cartoon" }), true);
  const ids = F.FEATURES.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, "feature ids are unique");
  F.FEATURES.forEach((f) => {
    assert.ok(["free", "vip"].includes(f.tier), f.id);
    assert.ok(["ready", "optional", "needs-model", "planned"].includes(f.status), f.id);
    assert.ok(F.CATEGORIES.some((c) => c.id === f.category), f.id);
  });
});

test("sanitize clamps numbers and drops unknown keys", () => {
  const s = E.sanitize({ denoise: 500, bright: -999, sat: "12.6", evil: 1, filter: "nope", style: "cartoon" });
  assert.equal(s.denoise, 100);
  assert.equal(s.bright, -50);
  assert.equal(s.sat, 13);
  assert.equal(s.filter, "none");
  assert.equal(s.style, "cartoon");
  assert.ok(!("evil" in s));
  assert.deepEqual(E.sanitize(null), E.DEFAULTS);
});

test("auto color balance reduces a color cast", () => {
  const img = solid(40, 40, 200, 140, 100);
  E.enhance(img, 40, 40, { autowb: 100 });
  const spread = Math.max(img.data[0], img.data[1], img.data[2]) - Math.min(img.data[0], img.data[1], img.data[2]);
  assert.ok(spread < 100 * 0.9, "spread " + spread);
});

test("portrait focus blur softens the edges but not the center", () => {
  const w = 80, h = 80, img = solid(w, h, 128, 128, 128);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, v = (x + y) % 2 ? 255 : 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; }
  const before = new Uint8ClampedArray(img.data);
  E.enhance(img, w, h, { tilt: 100 });
  const at = (d, x, y) => d[(y * w + x) * 4];
  const centerDiff = Math.abs(at(before, 40, 40) - at(img.data, 40, 40));
  const edgeDiff = Math.abs(at(before, 2, 2) - at(img.data, 2, 2));
  assert.ok(edgeDiff > centerDiff + 40, "edge " + edgeDiff + " center " + centerDiff);
});

test("inpaint fills a hole with the surrounding color", () => {
  const W = 60, H = 60, d = new Uint8ClampedArray(W * H * 4), mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const q = (y * W + x) * 4; d[q] = 200; d[q + 1] = 30; d[q + 2] = 30; d[q + 3] = 255;
    if (x >= 25 && x < 35 && y >= 25 && y < 35) { d[q] = 0; d[q + 1] = 255; d[q + 2] = 0; mask[y * W + x] = 1; }
  }
  E.inpaintRegion({ data: d }, W, H, mask);
  const c = (30 * W + 30) * 4;
  assert.ok(Math.abs(d[c] - 200) < 5 && Math.abs(d[c + 1] - 30) < 5);
});

test("flood fill and cutout select only the connected background", () => {
  const W = 60, H = 60, d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const q = (y * W + x) * 4, inbox = x >= 20 && x < 40 && y >= 20 && y < 40;
    d[q] = d[q + 1] = d[q + 2] = inbox ? 0 : 255; d[q + 3] = 255;
  }
  const vis = E.floodFill(d, W, H, 2, 2, 30);
  let n = 0; for (let i = 0; i < W * H; i++) n += vis[i];
  assert.equal(n, W * H - 400);
  const removed = E.applyCutout(d, W, H, vis);
  assert.equal(removed, W * H - 400);
  assert.equal(d[3], 0);
  assert.equal(d[(30 * W + 30) * 4 + 3], 255);
});

test("caption parsing and time formatting", () => {
  assert.equal(E.parseTime("1:05"), 65);
  assert.equal(E.parseTime("2.5"), 2.5);
  const caps = E.parseCaps("0:01-0:03 Hello world\nnot a caption\n5-4 reversed\n2.5 - 4 second");
  assert.equal(caps.length, 2);
  assert.equal(caps[0].t, "Hello world");
  assert.equal(caps[1].a, 2.5);
  assert.equal(E.fmt(75), "1:15");
});

test("teeth whitening only changes masked pixels and reduces yellow", () => {
  const W = 20, H = 10, img = solid(W, H, 235, 220, 150), mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < 10; x++) mask[y * W + x] = 255;
  E.whitenMasked(img.data, W, H, mask, 100);
  const inside = img.data[0 * 4], insideB = img.data[2], outsideB = img.data[(15) * 4 + 2];
  assert.ok(insideB > 150 + 20, "blue rose inside the mask: " + insideB);
  assert.equal(outsideB, 150);
  assert.ok(img.data[0] <= 255 && inside > 0);
});

test("recolor moves hue toward the target inside the mask only", () => {
  const W = 10, H = 10, img = solid(W, H, 120, 90, 80), mask = new Uint8Array(W * H);
  mask[0] = 255;
  E.recolorMasked(img.data, W, H, mask, [200, 30, 60], 100);
  assert.ok(img.data[0] > img.data[1] + 40, "red dominates inside");
  assert.equal(img.data[4], 120);
});

test("liquify push moves content, pinch shrinks, outside the radius is untouched", () => {
  const W = 60, H = 60, img = solid(W, H, 0, 0, 0);
  for (let y = 25; y < 35; y++) for (let x = 25; x < 35; x++) { const i = (y * W + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; }
  const before = new Uint8ClampedArray(img.data);
  E.liquify(img.data, W, H, 30, 30, 20, "push", 8, 0, 1);
  const at = (d, x, y) => d[(y * W + x) * 4];
  assert.ok(at(img.data, 38, 30) > at(before, 38, 30) + 50, "bright block pushed right");
  assert.equal(at(img.data, 2, 2), 0);
  assert.ok(!noNaN(img.data) === false);
  const p = solid(W, H, 0, 0, 0);
  for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) { const i = (y * W + x) * 4; p.data[i] = p.data[i + 1] = p.data[i + 2] = 255; }
  let whiteBefore = 0, whiteAfter = 0; for (let i = 0; i < W * H; i++) whiteBefore += p.data[i * 4] > 128 ? 1 : 0;
  E.liquify(p.data, W, H, 30, 30, 24, "pinch", 0, 0, 1);
  for (let i = 0; i < W * H; i++) whiteAfter += p.data[i * 4] > 128 ? 1 : 0;
  assert.ok(whiteAfter < whiteBefore, "pinch shrank the block: " + whiteBefore + " -> " + whiteAfter);
});

test("soft mask spreads coverage and script splits into timed captions", () => {
  const W = 21, H = 21, m = new Uint8Array(W * H); m[10 * W + 10] = 1;
  const s = E.softMask(m, W, H, 3);
  assert.ok(s[10 * W + 10] > 0 && s[10 * W + 10] < 255 && s[10 * W + 12] > 0);
  const caps = E.scriptToCaps("Hello there. This is a longer second sentence that must be split into pieces for readability.\nThird line", 2, 12);
  assert.ok(caps.length >= 4, "lines " + caps.length);
  assert.ok(Math.abs(caps[0].a - 2) < 1e-9 && Math.abs(caps[caps.length - 1].b - 12) < 1e-6);
  caps.forEach((c) => assert.ok(c.t.length <= 42 && c.b > c.a));
  assert.equal(E.parseCaps(E.capsToText(caps)).length, caps.length);
});

test("estimateShift recovers a known motion", () => {
  const W = 80, H = 45; let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const prev = new Uint8Array(W * H); for (let i = 0; i < prev.length; i++) prev[i] = rnd() * 255;
  [[3, -2], [-4, 1], [0, 0], [5, 5]].forEach(([dx, dy]) => {
    const cur = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const sx = Math.min(W - 1, Math.max(0, x + dx)), sy = Math.min(H - 1, Math.max(0, y + dy)); cur[y * W + x] = prev[sy * W + sx]; }
    const m = E.estimateShift(prev, cur, W, H, 5, 8);
    assert.deepEqual([m.dx, m.dy], [dx, dy]);
  });
});

test("AI enhance reads the image and picks sensible settings", () => {
  let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  const W = 120, H = 120;
  const mkimg = (fn) => { const d = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = fn(x, y), i = (y * W + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; } return d; };
  const dark = mkimg(() => { const n = rnd() * 40; return [40 + n, 40 + n, 45 + n]; });
  const a = E.aiEnhance(dark, W, H);
  assert.ok(a.settings.denoise >= 40, "noisy dark image gets strong denoise: " + a.settings.denoise);
  assert.ok(a.settings.bright > 5 && a.settings.shadows > 5, "dark image is lifted");
  assert.ok(a.notes.includes("dark") && a.notes.includes("noisy"), a.notes.join());
  const clean = mkimg((x, y) => { const v = ((x >> 3) + (y >> 3)) % 2 ? 235 : 20; return [v, v, v]; });
  const b = E.aiEnhance(clean, W, H);
  assert.ok(b.settings.denoise <= 10, "clean image gets little denoise: " + b.settings.denoise);
  assert.equal(b.settings.bright, 0);
  const cast = mkimg((x, y) => [Math.min(255, 70 + x), 50 + (y >> 1), 20 + (x >> 2)]);
  const c = E.aiEnhance(cast, W, H);
  assert.ok(c.settings.autowb >= 30 && c.notes.includes("color cast"), "color cast detected: " + c.settings.autowb);
  [a, b, c].forEach((r) => { assert.deepEqual(E.sanitize(r.settings), r.settings); const t = new Uint8ClampedArray(dark); E.enhance({ data: t }, W, H, r.settings); assert.ok(noNaN(t)); });
});

test("natural finish calms weak texture, keeps edges and tone, and never produces NaN", () => {
  const w = 96, h = 64, d = new Uint8ClampedArray(w * h * 4);
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, base = x < w / 2 ? 90 : 190, n = (rnd() - 0.5) * 24; // a hard edge plus fine noise on each side
    d[i] = base + n; d[i + 1] = base + n; d[i + 2] = base + n; d[i + 3] = 255;
  }
  const hf = (a, x0, x1) => { let s = 0, c = 0; for (let y = 1; y < h - 1; y++) for (let x = x0 + 1; x < x1 - 1; x++) { const i = (y * w + x) * 4, l = a[i] * 4 - a[i - 4] - a[i + 4] - a[i - w * 4] - a[i + w * 4]; s += l * l; c++; } return s / c; };
  const before = hf(d, 0, 40), edgeBefore = d[(32 * w + 60) * 4] - d[(32 * w + 30) * 4];
  const out = new Uint8ClampedArray(d); E.enhance({ data: out }, w, h, { natural: 100, calm: 100 });
  assert.ok(hf(out, 0, 40) < before * 0.7, "noise should drop: " + hf(out, 0, 40) + " vs " + before);
  assert.ok(out[(32 * w + 60) * 4] - out[(32 * w + 30) * 4] > edgeBefore * 0.8, "the edge must survive");
  for (let i = 0; i < out.length; i += 4) assert.equal(out[i + 3], 255);
  const off = new Uint8ClampedArray(d); E.enhance({ data: off }, w, h, { natural: 0, calm: 0 });
  assert.deepEqual(Array.from(off.slice(0, 64)), Array.from(d.slice(0, 64)), "off means untouched");
  const tiny = new Uint8ClampedArray([10, 20, 30, 255]); E.enhance({ data: tiny }, 1, 1, { natural: 100, calm: 100 });
  assert.ok(Array.from(tiny).every(Number.isFinite));
});

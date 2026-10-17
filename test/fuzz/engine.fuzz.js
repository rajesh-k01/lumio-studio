const E = require("../../public/js/engine.js");
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const sizes = [[1,1],[1,2],[2,1],[2,2],[1,9],[9,1],[3,5],[17,1],[1,100],[64,48],[255,3],[33,33]];
const fills = { black: () => 0, white: () => 255, gray: () => 128, noise: () => Math.floor(rnd() * 256), ramp: null };
const mk = (w, h, f, i0) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { const v = f === "ramp" ? Math.floor(i / Math.max(1, w * h - 1) * 255) : fills[f](); d[i*4]=v; d[i*4+1]=f==="noise"?fills.noise():v; d[i*4+2]=f==="noise"?fills.noise():v; d[i*4+3]=255; } return d; };
const bad = [];
const T = (name, fn) => { try { fn(); } catch (e) { bad.push(name + ": " + (e && e.message)); } };
const hostile = [NaN, Infinity, -Infinity, -1e9, 1e9, "abc", null, undefined, {}, [], "50", true, "__proto__", 0, -0, 1e-9];
let runs = 0;
for (const [w, h] of sizes) for (const f of Object.keys(fills)) {
  const label = `${w}x${h}/${f}`;
  T("analyze " + label, () => {
    const m = E.analyze(mk(w, h, f), w, h); runs++;
    for (const [k, v] of Object.entries(m)) if (typeof v === "number" && !Number.isFinite(v)) bad.push(`analyze ${label} ${k}=${v}`);
    const p = E.smartParams(m);
    for (const [k, v] of Object.entries(p)) if (typeof v === "number" && (!Number.isFinite(v) || v < -100 || v > 100)) bad.push(`smartParams ${label} ${k}=${v}`);
    const a = E.aiEnhance(mk(w, h, f), w, h); if (!a || !Array.isArray(a.notes || [])) bad.push("aiEnhance shape " + label);
  });
  T("enhance " + label, () => {
    // use a Float64Array copy so NaN/Infinity are visible (Uint8ClampedArray would hide them)
    const base = mk(w, h, f), fd = Float64Array.from(base); const img = { data: fd };
    E.enhance(img, w, h, { denoise: 100, sharpen: 100, contrast: 100, clarity: 100, dehaze: 100, autowb: 100, skin: 100, glow: 100, vignette: 100, grain: 100, shadows: 100, highlights: 100, sat: 100, warm: 100, filter: "sepia", style: "none" }); runs++;
    if (img.data.length !== w * h * 4) bad.push("enhance size " + label);
    for (let i = 0; i < img.data.length; i++) if (!Number.isFinite(img.data[i])) { bad.push(`enhance non-finite ${label} @${i}`); break; }
    const u8 = { data: mk(w, h, f) }; E.enhance(u8, w, h, { sharpen: 60, denoise: 60 });
  });
  T("estimateShift " + label, () => { const g = new Uint8Array(w * h); for (let i = 0; i < g.length; i++) g[i] = rnd() * 255; E.estimateShift(g, g, w, h, 2, 1); runs++; });
  T("liquify " + label, () => { E.liquify(mk(w, h, f), w, h, w / 2, h / 2, 10, "push", 3, 3, 1); E.liquify(mk(w, h, f), w, h, -50, 1e9, 1e9, "pinch", 0, 0, 1); runs++; });
  T("masked " + label, () => { const mask = new Uint8Array(w * h).fill(1); E.whitenMasked(mk(w, h, f), w, h, mask, 100); E.recolorMasked(mk(w, h, f), w, h, mask, [255, 0, 0], 100); E.softMask(mask, w, h, 3); runs++; });
  T("inpaint " + label, () => { const mask = new Uint8Array(w * h).fill(1); E.inpaintRegion({ data: mk(w, h, f) }, w, h, mask); E.inpaintRegion({ data: mk(w, h, f) }, w, h, new Uint8Array(w * h)); runs++; });
  T("floodFill " + label, () => { E.floodFill(mk(w, h, f), w, h, 0, 0, 30); E.floodFill(mk(w, h, f), w, h, w + 5, h + 5, 30); E.floodFill(mk(w, h, f), w, h, -3, -3, 30); runs++; });
}
for (const v of hostile) for (const key of Object.keys(E.DEFAULTS)) T(`sanitize ${key}=${String(v)}`, () => {
  const s = E.sanitize({ [key]: v }); runs++;
  for (const [k, val] of Object.entries(s)) { if (typeof E.DEFAULTS[k] === "number" && !Number.isFinite(val)) bad.push(`sanitize ${key}=${String(v)} -> ${k}=${val}`); }
  const L = E.LIMITS && E.LIMITS[key]; if (L && typeof s[key] === "number" && (s[key] < L[0] || s[key] > L[1])) bad.push(`sanitize out of range ${key}=${String(v)} -> ${s[key]} (limits ${L})`);
});
T("sanitize junk root", () => { for (const j of [null, undefined, 5, "x", [], JSON.parse('{"__proto__":{"polluted":1}}')]) E.sanitize(j); if (({}).polluted) bad.push("PROTOTYPE POLLUTION"); runs++; });
T("parseCaps", () => { for (const t of ["", "0:00 hi", "1:2:3 x", "99999999999 a", "-5 neg", "\u0000", "a".repeat(1e5)]) { E.parseCaps(t); E.parseTime(t); } runs++; });
T("scriptToCaps", () => { for (const [t, d] of [["", 10], ["hello", 0], ["a b c", -5], ["x".repeat(5000), 1e9], ["hi", NaN]]) { const c = E.scriptToCaps(t, d); E.capsToText(c); } runs++; });
T("fmt", () => { for (const v of [NaN, -1, Infinity, 1e12, "x"]) E.fmt(v); runs++; });
console.log("runs:", runs, "problems:", bad.length); bad.slice(0, 60).forEach((b) => console.log(" -", b));

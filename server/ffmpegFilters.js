"use strict";
/*
 * Turns Lumio enhancement settings into an FFmpeg filter chain.
 * FFmpeg has no exact equivalent of every Lumio effect, so some settings are approximated and
 * a few are skipped. The skipped list is returned so the app can tell the user.
 */
const engine = require("../public/js/engine.js");

const odd = (n) => { n = Math.round(n); return n % 2 ? n : n + 1; };
const even = (n) => { n = Math.round(n); return n % 2 ? n + 1 : n; };
const f = (n, d = 3) => Number(n.toFixed(d)).toString();

/* atempo only accepts 0.5 to 2 per stage, so chain stages for other speeds. */
function atempoChain(speed) {
  const parts = [];
  while (speed > 2) { parts.push("atempo=2"); speed /= 2; }
  while (speed < 0.5) { parts.push("atempo=0.5"); speed *= 2; }
  parts.push("atempo=" + f(speed, 4));
  return parts.join(",");
}

/* o: { outH (output height), fps, mirror, speed, outW } */
function buildFilters(raw, o) {
  const s = engine.sanitize(raw), vf = [], skipped = [];
  if (o.mirror) vf.push("hflip");
  if (o.speed && o.speed !== 1) vf.push("setpts=PTS/" + f(o.speed, 4));
  if (s.denoise) { const ls = s.denoise * 0.08, lt = ls * 1.5; vf.push(`hqdn3d=${f(ls, 2)}:${f(ls * 0.75, 2)}:${f(lt, 2)}:${f(lt * 0.75, 2)}`); }
  vf.push(`scale=${o.outW}:${o.outH}:flags=lanczos`);

  if (s.autowb || s.contrast) {
    const strength = Math.max(s.autowb, s.contrast) / 100, ind = s.autowb ? Math.min(1, s.autowb / 100) : 0;
    vf.push(`normalize=independence=${f(ind, 2)}:strength=${f(strength, 2)}:smoothing=${Math.max(1, Math.round(o.fps || 24))}`);
  }
  const eq = [];
  const brightness = s.bright / 50 * 0.2 - s.dehaze / 100 * 0.03, contrast = 1 + s.dehaze / 100 * 0.3, sat = 1 + s.sat / 100;
  if (Math.abs(brightness) > 1e-4) eq.push("brightness=" + f(brightness));
  if (Math.abs(contrast - 1) > 1e-4) eq.push("contrast=" + f(contrast));
  if (Math.abs(sat - 1) > 1e-4) eq.push("saturation=" + f(sat));
  if (eq.length) vf.push("eq=" + eq.join(":"));
  if (s.shadows || s.highlights) {
    const lo = Math.min(0.5, Math.max(0, 0.25 + s.shadows / 50 * 0.12)), hi = Math.min(1, Math.max(0.5, 0.75 + s.highlights / 50 * 0.12));
    vf.push(`curves=all='0/0 0.25/${f(lo)} 0.75/${f(hi)} 1/1'`);
  }
  if (s.warm) { const w = s.warm / 50 * 0.15; vf.push(`colorbalance=rm=${f(w)}:bm=${f(-w)}:rh=${f(w / 2)}:bh=${f(-w / 2)}`); }
  if (s.clarity) vf.push(`unsharp=${Math.min(23, odd(o.outH / 90))}:${Math.min(23, odd(o.outH / 90))}:${f(s.clarity / 100 * 0.8)}:5:5:0`);
  if (s.sharpen) { const k = o.outH >= 4000 ? 13 : o.outH >= 2000 ? 9 : o.outH >= 1300 ? 7 : 5; vf.push(`unsharp=${k}:${k}:${f(s.sharpen / 100 * 1.5)}:${k}:${k}:0`); }
  if (s.filter === "bw") vf.push("hue=s=0");
  else if (s.filter === "sepia") vf.push("colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131:0");
  else if (s.filter !== "none") skipped.push("filter " + s.filter);
  if (s.vignette) vf.push(`vignette=angle=${f(Math.PI / 4 * (0.3 + s.vignette / 100 * 0.9))}`);
  if (s.grain) vf.push(`noise=alls=${Math.round(s.grain * 0.3)}:allf=t`);
  ["skin", "glow", "tilt"].forEach((k) => { if (s[k]) skipped.push(k); });
  if (s.style !== "none") skipped.push("style " + s.style);
  return { vf: vf.join(","), skipped };
}

module.exports = { buildFilters, atempoChain, even };

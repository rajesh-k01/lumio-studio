"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { loadConfig } = require("../server/config");
const { openDb } = require("../server/db");
const { createApp } = require("../server/app");

function boot(overrides) {
  const cfg = loadConfig(Object.assign({ dbFile: ":memory:", scryptN: 1024 }, overrides));
  const db = openDb(":memory:");
  const { app } = createApp(cfg, db);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const base = "http://127.0.0.1:" + server.address().port;
      resolve({ base, close: () => new Promise((r) => server.close(() => { db.close(); r(); })) });
    });
  });
}

function client(base) {
  let cookie = "";
  async function call(method, path, opts) {
    opts = opts || {};
    const headers = Object.assign({ "x-requested-with": "lumio" }, opts.headers || {});
    if (cookie) headers.cookie = cookie;
    let body;
    if (opts.json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(opts.json); }
    if (opts.raw !== undefined) { body = opts.raw; }
    if (opts.noCsrf) delete headers["x-requested-with"];
    const res = await fetch(base + path, { method, headers, body });
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    set.forEach((c) => { const kv = c.split(";")[0]; cookie = kv.endsWith("=") ? "" : kv; });
    const type = res.headers.get("content-type") || "";
    const data = type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  }
  return { call, get cookie() { return cookie; } };
}

async function png(w, h, bg, box) {
  let img = sharp({ create: { width: w, height: h, channels: 3, background: bg } });
  if (box) img = img.composite([{ input: { create: { width: box.w, height: box.h, channels: 3, background: box.color } }, left: box.x, top: box.y }]);
  return img.png().toBuffer();
}

const USER = { name: "Asha", email: "asha@example.com", password: "correct horse" };

test("health and feature registry", async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const c = client(s.base);
  const h = await c.call("GET", "/api/health");
  assert.equal(h.status, 200);
  assert.equal(h.data.ok, true);
  const f = await c.call("GET", "/api/features");
  assert.equal(f.status, 200);
  assert.ok(f.data.features.length > 40);
  assert.equal(f.data.entitlements.tier, "free");
  assert.ok(f.data.features.every((x) => ["free", "vip"].includes(x.tier)));
  assert.equal(f.data.summary.free + f.data.summary.vip, f.data.summary.total);
});

test("csrf header is required on writes", async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const c = client(s.base);
  const r = await c.call("POST", "/api/auth/login", { json: { email: "a@b.co", password: "x" }, noCsrf: true });
  assert.equal(r.status, 403);
  assert.equal(r.data.error.code, "csrf");
});

test("register, session, logout and login", async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const c = client(s.base);
  let r = await c.call("POST", "/api/auth/register", { json: { name: "A", email: "bad", password: "correct horse" } });
  assert.equal(r.status, 400);
  assert.equal(r.data.error.code, "invalid_email");
  r = await c.call("POST", "/api/auth/register", { json: { name: "A", email: "a@b.co", password: "short" } });
  assert.equal(r.data.error.code, "invalid_password");
  r = await c.call("POST", "/api/auth/register", { json: USER });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.vip, true);
  assert.equal(r.data.user.tier, "vip");
  assert.ok(!("pass_hash" in r.data.user));
  assert.match(c.cookie, /^lumio_session=/);
  const setCookie = (await fetch(s.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "lumio" }, body: JSON.stringify({ email: USER.email, password: USER.password }) })).headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);

  r = await c.call("GET", "/api/auth/me");
  assert.equal(r.data.user.email, USER.email);

  r = await c.call("POST", "/api/auth/register", { json: USER });
  assert.equal(r.status, 409);

  r = await c.call("POST", "/api/auth/logout", { json: {} });
  assert.equal(r.status, 200);
  r = await c.call("GET", "/api/auth/me");
  assert.equal(r.data.user, null);

  r = await c.call("POST", "/api/auth/login", { json: { email: USER.email, password: "wrong password" } });
  assert.equal(r.status, 401);
  r = await c.call("POST", "/api/auth/login", { json: { email: "nobody@example.com", password: "wrong password" } });
  assert.equal(r.status, 401);
  assert.equal(r.data.error.message, "Wrong email or password.");
  r = await c.call("POST", "/api/auth/login", { json: { email: USER.email.toUpperCase(), password: USER.password } });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.name, "Asha");
});

test("guests cannot reach VIP routes", async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const c = client(s.base);
  for (const [m, p] of [["GET", "/api/projects"], ["POST", "/api/projects"], ["GET", "/api/formulas"], ["POST", "/api/process"], ["POST", "/api/cutout"]]) {
    const r = await c.call(m, p, m === "POST" ? { json: {} } : {});
    assert.equal(r.status, 401, m + " " + p);
    assert.equal(r.data.error.code, "auth_required");
  }
  const r = await c.call("GET", "/api/nope");
  assert.equal(r.status, 404);
});

test("claim policy: login alone is free tier until VIP is claimed", async (t) => {
  const s = await boot({ vipPolicy: "claim" });
  t.after(() => s.close());
  const c = client(s.base);
  let r = await c.call("POST", "/api/auth/register", { json: USER });
  assert.equal(r.data.user.vip, false);
  r = await c.call("GET", "/api/projects");
  assert.equal(r.status, 403);
  assert.equal(r.data.error.code, "vip_required");
  r = await c.call("POST", "/api/vip/claim", { json: {} });
  assert.equal(r.data.user.vip, true);
  r = await c.call("GET", "/api/projects");
  assert.equal(r.status, 200);
});

test("projects: create, list, update, image, isolation, delete", async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const a = client(s.base), b = client(s.base);
  await a.call("POST", "/api/auth/register", { json: USER });
  await b.call("POST", "/api/auth/register", { json: { name: "Ben", email: "ben@example.com", password: "another long one" } });

  let r = await a.call("POST", "/api/projects", { json: { name: "  Sunset  ", mode: "photo", settings: { denoise: 999, sharpen: "40", evil: 1, filter: "nope" } } });
  assert.equal(r.status, 201);
  const id = r.data.project.id;
  assert.equal(r.data.project.name, "Sunset");
  assert.equal(r.data.project.settings.denoise, 100);
  assert.equal(r.data.project.settings.sharpen, 40);
  assert.equal(r.data.project.settings.filter, "none");
  assert.ok(!("evil" in r.data.project.settings));

  r = await a.call("POST", "/api/projects", { json: { name: "" } });
  assert.equal(r.status, 400);
  r = await a.call("POST", "/api/projects", { json: { name: "x", thumb: "javascript:alert(1)" } });
  assert.equal(r.data.error.code, "invalid_thumb");

  r = await a.call("PUT", "/api/projects/" + id, { json: { name: "Sunset v2", settings: { sat: 20 } } });
  assert.equal(r.data.project.name, "Sunset v2");
  assert.equal(r.data.project.settings.sat, 20);

  const img = await png(30, 20, { r: 10, g: 120, b: 200 });
  r = await a.call("PUT", "/api/projects/" + id + "/image", { raw: img, headers: { "content-type": "image/png" } });
  assert.equal(r.status, 200);
  r = await a.call("PUT", "/api/projects/" + id + "/image", { raw: Buffer.from("not an image"), headers: { "content-type": "image/png" } });
  assert.equal(r.data.error.code, "invalid_image");
  r = await a.call("PUT", "/api/projects/" + id + "/image", { raw: img, headers: { "content-type": "text/html" } });
  assert.equal(r.status, 415);
  r = await a.call("GET", "/api/projects/" + id + "/image");
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, img);

  r = await a.call("GET", "/api/projects");
  assert.equal(r.data.projects.length, 1);
  assert.equal(r.data.projects[0].hasImage, true);
  assert.ok(r.data.usageBytes > 0);

  r = await b.call("GET", "/api/projects/" + id);
  assert.equal(r.status, 404);
  r = await b.call("DELETE", "/api/projects/" + id);
  assert.equal(r.status, 404);
  r = await b.call("GET", "/api/projects");
  assert.equal(r.data.projects.length, 0);

  r = await a.call("DELETE", "/api/projects/" + id);
  assert.equal(r.status, 200);
  r = await a.call("GET", "/api/projects/" + id);
  assert.equal(r.status, 404);
});

test("formulas: create, share by code, guests can apply, only owner deletes", async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const a = client(s.base), guest = client(s.base), b = client(s.base);
  await a.call("POST", "/api/auth/register", { json: USER });
  await b.call("POST", "/api/auth/register", { json: { name: "Ben", email: "ben@example.com", password: "another long one" } });
  let r = await a.call("POST", "/api/formulas", { json: { name: "Warm portrait", settings: { skin: 50, warm: 12, filter: "golden", hack: "x" } } });
  assert.equal(r.status, 201);
  const code = r.data.formula.code, id = r.data.formula.id;
  assert.match(code, /^[A-Z0-9]{8}$/);
  r = await guest.call("GET", "/api/formulas/public/" + code.toLowerCase());
  assert.equal(r.status, 200);
  assert.equal(r.data.formula.settings.skin, 50);
  assert.equal(r.data.formula.settings.filter, "golden");
  assert.equal(r.data.formula.author, "Asha");
  assert.ok(!("hack" in r.data.formula.settings));
  r = await guest.call("GET", "/api/formulas/public/AAAAAAAA");
  assert.equal(r.status, 404);
  r = await guest.call("GET", "/api/formulas/public/x");
  assert.equal(r.status, 400);
  r = await guest.call("GET", "/api/formulas");
  assert.equal(r.status, 401);
  r = await b.call("DELETE", "/api/formulas/" + id);
  assert.equal(r.status, 404);
  r = await a.call("GET", "/api/formulas");
  assert.equal(r.data.formulas.length, 1);
  r = await a.call("DELETE", "/api/formulas/" + id);
  assert.equal(r.status, 200);
});

test("cloud render upscales and enhances with the shared engine", async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const c = client(s.base);
  await c.call("POST", "/api/auth/register", { json: USER });
  const src = await png(60, 40, { r: 90, g: 100, b: 110 });
  const settings = encodeURIComponent(JSON.stringify({ sharpen: 50, contrast: 60, filter: "sepia", fstr: 100 }));

  let r = await c.call("POST", "/api/process?scale=2", { raw: src, headers: { "content-type": "image/png", "x-lumio-settings": settings } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-lumio-width"), "120");
  assert.equal(r.headers.get("x-lumio-height"), "80");
  const meta = await sharp(r.data).metadata();
  assert.equal(meta.width, 120);
  const px = await sharp(r.data).raw().toBuffer();
  assert.ok(px[0] > px[2], "sepia filter should make red stronger than blue");

  r = await c.call("POST", "/api/process?scale=3&format=jpeg&quality=80", { raw: src, headers: { "content-type": "image/png" } });
  assert.equal(r.headers.get("content-type"), "image/jpeg");
  assert.equal((await sharp(r.data).metadata()).width, 180);

  r = await c.call("POST", "/api/process?scale=2", { raw: Buffer.from("garbage"), headers: { "content-type": "image/png" } });
  assert.equal(r.status, 400);
  assert.equal(r.data.error.code, "invalid_image");
  r = await c.call("POST", "/api/process", { json: {} });
  assert.equal(r.status, 415);
  r = await c.call("POST", "/api/process", { raw: src, headers: { "content-type": "image/png", "x-lumio-settings": "%7Bbad" } });
  assert.equal(r.status, 400);
  assert.equal(r.data.error.code, "invalid_settings");
});

test("cloud render respects the output size cap", async (t) => {
  const s = await boot({ maxOutputPixels: 10000 });
  t.after(() => s.close());
  const c = client(s.base);
  await c.call("POST", "/api/auth/register", { json: USER });
  const src = await png(60, 40, { r: 1, g: 2, b: 3 });
  const r = await c.call("POST", "/api/process?scale=8", { raw: src, headers: { "content-type": "image/png" } });
  assert.equal(r.status, 200);
  const m = await sharp(r.data).metadata();
  assert.ok(m.width * m.height <= 10000 + 200);
  assert.equal(r.headers.get("x-lumio-capped"), "1");
});

test("cutout makes the clicked background transparent", async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const c = client(s.base);
  await c.call("POST", "/api/auth/register", { json: USER });
  const src = await png(80, 60, { r: 255, g: 255, b: 255 }, { x: 30, y: 20, w: 20, h: 20, color: { r: 200, g: 0, b: 0 } });
  let r = await c.call("POST", "/api/cutout?x=0.02&y=0.02&tol=20", { raw: src, headers: { "content-type": "image/png" } });
  assert.equal(r.status, 200);
  const { data, info } = await sharp(r.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];
  assert.equal(alphaAt(1, 1), 0);
  assert.equal(alphaAt(40, 30), 255);
  r = await c.call("POST", "/api/cutout?x=0.5&y=0.5&tol=100", { raw: await png(40, 40, { r: 5, g: 5, b: 5 }), headers: { "content-type": "image/png" } });
  assert.equal(r.status, 422);
});

test("neural upscaling reports clearly when the AI worker is off", async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const c = client(s.base);
  await c.call("POST", "/api/auth/register", { json: USER });
  const r = await c.call("POST", "/api/ai/upscale", { raw: await png(20, 20, { r: 1, g: 1, b: 1 }), headers: { "content-type": "image/png" } });
  assert.equal(r.status, 501);
  assert.equal(r.data.error.code, "ai_unavailable");
});

test("login attempts are rate limited", async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const c = client(s.base);
  let last;
  for (let i = 0; i < 32; i++) last = await c.call("POST", "/api/auth/login", { json: { email: "x@example.com", password: "whatever1" } });
  assert.equal(last.status, 429);
  assert.equal(last.data.error.code, "rate_limited");
});

test("account deletion removes the user and their data", async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const c = client(s.base);
  await c.call("POST", "/api/auth/register", { json: USER });
  await c.call("POST", "/api/projects", { json: { name: "P" } });
  let r = await c.call("DELETE", "/api/auth/account", { json: { password: "nope nope nope" } });
  assert.equal(r.status, 401);
  r = await c.call("DELETE", "/api/auth/account", { json: { password: USER.password } });
  assert.equal(r.status, 200);
  r = await c.call("POST", "/api/auth/login", { json: { email: USER.email, password: USER.password } });
  assert.equal(r.status, 401);
});

test("static app and security headers", async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const res = await fetch(s.base + "/");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  const js = await fetch(s.base + "/js/engine.js");
  assert.equal(js.status, 200);
  const spa = await fetch(s.base + "/formulas");
  assert.equal(spa.status, 200);
});

test("image render accepts a target short side (HD, 2K, 4K, 8K) and can also downscale", async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const c = client(s.base);
  await c.call("POST", "/api/auth/register", { json: USER });
  const src = await png(60, 40, { r: 90, g: 100, b: 110 });
  const hdr = { "content-type": "image/png" };
  let r = await c.call("POST", "/api/process?target=80", { raw: src, headers: hdr });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-lumio-height"), "80");
  assert.equal(r.headers.get("x-lumio-width"), "120");
  r = await c.call("POST", "/api/process?target=20", { raw: src, headers: hdr });
  assert.equal(r.headers.get("x-lumio-height"), "20");
  assert.equal(r.headers.get("x-lumio-width"), "30");
  r = await c.call("POST", "/api/process?target=4320&scale=2", { raw: await png(80, 45, { r: 9, g: 9, b: 9 }), headers: hdr });
  assert.equal(r.status, 200, "8K target on a small image");
  assert.equal(r.headers.get("x-lumio-height"), "4320");
  assert.equal(r.headers.get("x-lumio-width"), "7680");
  assert.equal(r.headers.get("x-lumio-capped"), "0");
});

test("ffmpeg filter builder maps settings and reports what it skips", () => {
  const { buildFilters, atempoChain } = require("../server/ffmpegFilters");
  const a = buildFilters({ denoise: 50, sharpen: 40, autowb: 60, bright: 10, sat: 10, warm: 20, vignette: 30, grain: 10, clarity: 20, filter: "bw" }, { outW: 1280, outH: 720, fps: 30, mirror: true, speed: 2 });
  for (const part of ["hflip", "setpts=PTS/2", "hqdn3d=", "scale=1280:720:flags=lanczos", "normalize=", "eq=", "colorbalance=", "unsharp=", "hue=s=0", "vignette=", "noise="]) assert.ok(a.vf.includes(part), "has " + part + " in " + a.vf);
  assert.ok(a.vf.indexOf("hqdn3d") < a.vf.indexOf("scale="), "denoise runs before scaling");
  assert.deepEqual(a.skipped, []);
  const b = buildFilters({ skin: 30, glow: 10, filter: "noir", style: "cartoon" }, { outW: 640, outH: 360, fps: 24 });
  assert.deepEqual(b.skipped, ["filter noir", "skin", "glow", "style cartoon"]);
  assert.equal(atempoChain(3), "atempo=2,atempo=1.5");
  assert.equal(atempoChain(0.25), "atempo=0.5,atempo=0.5");
});

const { execFileSync, spawnSync } = require("node:child_process");
const haveFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
function dims(file) {
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", file]).toString());
  const v = j.streams.find((x) => x.codec_type === "video");
  return { w: v.width, h: v.height, audio: j.streams.some((x) => x.codec_type === "audio"), dur: Number(j.format.duration) };
}
async function waitFfmpeg(c) { for (let i = 0; i < 40; i++) { const h = await c.call("GET", "/api/health"); if (h.data.ffmpeg) return true; await new Promise((r) => setTimeout(r, 100)); } return false; }

test("server video render resizes, enhances, trims, speeds up and keeps audio", { skip: !haveFfmpeg, timeout: 120000 }, async (t) => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lumio-vt-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const clip = path.join(dir, "clip.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x180:rate=15", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", clip]);
  const bytes = fs.readFileSync(clip);
  const s = await boot();
  t.after(() => s.close());
  const c = client(s.base);
  const hdr = { "content-type": "video/mp4" };

  let r = await c.call("POST", "/api/video/enhance?target=360", { raw: bytes, headers: hdr });
  assert.equal(r.status, 401, "guests are refused");
  await c.call("POST", "/api/auth/register", { json: USER });
  assert.equal(await waitFfmpeg(c), true, "health reports ffmpeg");

  r = await c.call("POST", "/api/video/enhance?target=360", { raw: bytes, headers: { "content-type": "text/plain" } });
  assert.equal(r.status, 415);
  r = await c.call("POST", "/api/video/enhance?target=360", { raw: Buffer.from("not a video at all"), headers: hdr });
  assert.equal(r.status, 400);
  assert.equal(r.data.error.code, "invalid_video");

  const settings = encodeURIComponent(JSON.stringify({ denoise: 40, sharpen: 50, autowb: 60, bright: 10, sat: 10, warm: 20, vignette: 30, grain: 10, clarity: 20, filter: "bw", skin: 30 }));
  r = await c.call("POST", "/api/video/enhance?target=360&speed=2&mirror=1&start=0.2&end=1.8", { raw: bytes, headers: Object.assign({ "x-lumio-settings": settings }, hdr) });
  assert.equal(r.status, 200, r.status === 200 ? "" : JSON.stringify(r.data.error));
  assert.equal(r.headers.get("x-lumio-width"), "640");
  assert.equal(r.headers.get("x-lumio-height"), "360");
  assert.equal(r.headers.get("x-lumio-skipped"), "skin");
  const out = path.join(dir, "out.mp4"); fs.writeFileSync(out, r.data);
  const d = dims(out);
  assert.deepEqual([d.w, d.h], [640, 360]);
  assert.ok(d.audio, "audio kept");
  assert.ok(d.dur > 0.5 && d.dur < 1.2, "1.6 s at 2x is about 0.8 s: " + d.dur);
});

test("server video render can reach 8K", { skip: !haveFfmpeg, timeout: 170000 }, async (t) => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lumio-v8-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const clip = path.join(dir, "small.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=0.6:size=160x90:rate=10", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);
  const s = await boot();
  t.after(() => s.close());
  const c = client(s.base);
  await c.call("POST", "/api/auth/register", { json: USER });
  assert.equal(await waitFfmpeg(c), true);
  const r = await c.call("POST", "/api/video/enhance?target=4320", { raw: fs.readFileSync(clip), headers: { "content-type": "video/mp4", "x-lumio-settings": encodeURIComponent(JSON.stringify({ sharpen: 40 })) } });
  assert.equal(r.status, 200, r.status === 200 ? "" : JSON.stringify(r.data.error));
  assert.equal(r.headers.get("x-lumio-width"), "7680");
  assert.equal(r.headers.get("x-lumio-height"), "4320");
  const out = path.join(dir, "out.mp4"); fs.writeFileSync(out, r.data);
  const d = dims(out); assert.deepEqual([d.w, d.h], [7680, 4320]);
});

/* Real neural worker test. Needs OpenCV contrib 4.x and EDSR_x2.pb, so it only runs when you point it at them:
   LUMIO_TEST_PYTHON=/path/to/python LUMIO_TEST_MODELS=/path/to/models npm test */
test("neural upscale route runs the real EDSR worker", { skip: !process.env.LUMIO_TEST_PYTHON && "set LUMIO_TEST_PYTHON and LUMIO_TEST_MODELS to run" }, async (t) => {
  const s = await boot({ aiWorker: true, aiEngine: "edsr", aiMaxPixels: 300000, pythonBin: process.env.LUMIO_TEST_PYTHON, aiModelDir: process.env.LUMIO_TEST_MODELS || "" });
  t.after(() => s.close());
  const c = client(s.base);
  await c.call("POST", "/api/auth/register", { json: USER });
  const src = await png(48, 32, { r: 90, g: 120, b: 200 }, { x: 10, y: 8, w: 20, h: 12, color: { r: 240, g: 240, b: 240 } });
  const r = await c.call("POST", "/api/ai/upscale?scale=2", { raw: src, headers: { "content-type": "image/png" } });
  assert.equal(r.status, 200, r.data && r.data.error && r.data.error.message);
  const meta = await sharp(r.data).metadata();
  assert.deepEqual([meta.width, meta.height], [96, 64]);
  const big = await png(700, 500, { r: 1, g: 2, b: 3 });
  const tooBig = await c.call("POST", "/api/ai/upscale?scale=2", { raw: big, headers: { "content-type": "image/png" } });
  assert.equal(tooBig.status, 413);
});

/* Real-ESRGAN worker test. Needs torch and realesr-general-x4v3.pth:
   LUMIO_TEST_TORCH_PYTHON=/path/to/python LUMIO_TEST_TORCH_MODELS=/folder/with/the/pth npm test */
test("neural upscale route runs the real Real-ESRGAN worker", { skip: !process.env.LUMIO_TEST_TORCH_PYTHON && "set LUMIO_TEST_TORCH_PYTHON and LUMIO_TEST_TORCH_MODELS to run" }, async (t) => {
  const s = await boot({ aiWorker: true, aiEngine: "realesrgan", aiMaxPixels: 5000, pythonBin: process.env.LUMIO_TEST_TORCH_PYTHON, aiModelDir: process.env.LUMIO_TEST_TORCH_MODELS || "" });
  t.after(() => s.close());
  const c = client(s.base);
  await c.call("POST", "/api/auth/register", { json: USER });
  const src = await png(48, 32, { r: 90, g: 120, b: 200 }, { x: 10, y: 8, w: 20, h: 12, color: { r: 240, g: 240, b: 240 } });
  for (const [scale, w, h] of [[2, 96, 64], [3.5, 168, 112]]) {
    const r = await c.call("POST", "/api/ai/upscale?scale=" + scale + "&natural=0.3", { raw: src, headers: { "content-type": "image/png" } });
    assert.equal(r.status, 200, r.data && r.data.error && r.data.error.message);
    const meta = await sharp(r.data).metadata();
    assert.deepEqual([meta.width, meta.height], [w, h]);
  }
  const big = await png(100, 80, { r: 1, g: 2, b: 3 });
  const tooBig = await c.call("POST", "/api/ai/upscale?scale=2", { raw: big, headers: { "content-type": "image/png" } });
  assert.equal(tooBig.status, 413);
});

/* Face restoration (Real-ESRGAN, then GFPGAN). Needs torch, facexlib, realesr-general-x4v3.pth, GFPGANv1.4.pth and a portrait with the head in the upper middle of the frame:
   LUMIO_TEST_TORCH_PYTHON=... LUMIO_TEST_TORCH_MODELS=/folder/with/both/pth/files (and facexlib/ inside it, or internet) LUMIO_TEST_FACE_IMAGE=/path/to/portrait.jpg npm test */
test("neural upscale route restores faces when asked", { skip: !(process.env.LUMIO_TEST_TORCH_PYTHON && process.env.LUMIO_TEST_FACE_IMAGE) && "set LUMIO_TEST_TORCH_PYTHON, LUMIO_TEST_TORCH_MODELS and LUMIO_TEST_FACE_IMAGE to run" }, async (t) => {
  const s = await boot({ aiWorker: true, aiEngine: "realesrgan", aiFaces: true, aiMaxPixels: 400000, aiTimeoutMs: 280000, pythonBin: process.env.LUMIO_TEST_TORCH_PYTHON, aiModelDir: process.env.LUMIO_TEST_TORCH_MODELS || "" });
  t.after(() => s.close());
  const c = client(s.base);
  assert.equal((await c.call("GET", "/api/health")).data.faces, true);
  await c.call("POST", "/api/auth/register", { json: USER });
  const meta = await sharp(process.env.LUMIO_TEST_FACE_IMAGE).metadata();
  const side = Math.min(meta.width, meta.height, 300);
  const src = await sharp(process.env.LUMIO_TEST_FACE_IMAGE).rotate().extract({ left: Math.floor((meta.width - side) / 2), top: Math.min(meta.height - side, Math.floor(meta.height * 0.17)), width: side, height: side }).png().toBuffer();
  const plain = await c.call("POST", "/api/ai/upscale?scale=2", { raw: src, headers: { "content-type": "image/png" } });
  const faced = await c.call("POST", "/api/ai/upscale?scale=2&faces=0.7", { raw: src, headers: { "content-type": "image/png" } });
  assert.equal(plain.status, 200); assert.equal(faced.status, 200, faced.data && faced.data.error && faced.data.error.message);
  const a = await sharp(plain.data).raw().toBuffer({ resolveWithObject: true }), b = await sharp(faced.data).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([a.info.width, a.info.height], [b.info.width, b.info.height]);
  let diff = 0; for (let i = 0; i < a.data.length; i += 7) diff += Math.abs(a.data[i] - b.data[i]);
  assert.ok(diff / (a.data.length / 7) > 1, "face pass changed the image: " + (diff / (a.data.length / 7)).toFixed(2));
});

/* neural=1 on the normal export route must never fail the export: without the worker it falls back and says so. */
test("process route falls back cleanly when AI is asked for but unavailable", async (t) => {
  const s = await boot({});
  t.after(() => s.close());
  const c = client(s.base);
  await c.call("POST", "/api/auth/register", { json: USER });
  const src = await png(40, 30, { r: 90, g: 120, b: 200 });
  const r = await c.call("POST", "/api/process?target=90&neural=1&faces=0.7&format=png", { raw: src, headers: { "content-type": "image/png" } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-lumio-neural"), "unavailable");
  assert.equal((await sharp(r.data).metadata()).height, 90);
  const off = await c.call("POST", "/api/process?target=90&format=png", { raw: src, headers: { "content-type": "image/png" } });
  assert.equal(off.headers.get("x-lumio-neural"), "off");
});

test("process route runs the real AI pipeline for HD to 4K targets and falls back on big images", { skip: !process.env.LUMIO_TEST_TORCH_PYTHON && "set LUMIO_TEST_TORCH_PYTHON and LUMIO_TEST_TORCH_MODELS to run" }, async (t) => {
  const s = await boot({ aiWorker: true, aiEngine: "realesrgan", aiMaxPixels: 6000, pythonBin: process.env.LUMIO_TEST_TORCH_PYTHON, aiModelDir: process.env.LUMIO_TEST_TORCH_MODELS || "" });
  t.after(() => s.close());
  const c = client(s.base);
  await c.call("POST", "/api/auth/register", { json: USER });
  const small = await png(48, 32, { r: 90, g: 120, b: 200 }, { x: 10, y: 8, w: 20, h: 12, color: { r: 240, g: 240, b: 240 } });
  for (const target of [64, 128, 200]) {
    const r = await c.call("POST", "/api/process?target=" + target + "&neural=1&format=png", { raw: small, headers: { "content-type": "image/png" } });
    assert.equal(r.status, 200, r.data && r.data.error && r.data.error.message);
    assert.equal(r.headers.get("x-lumio-neural"), "ai");
    assert.equal((await sharp(r.data).metadata()).height, target);
  }
  // "AI enhance" keeps the size: neural=1 with force=1 and no target
  const same = await c.call("POST", "/api/process?scale=1&neural=1&force=1&format=png", { raw: small, headers: { "content-type": "image/png" } });
  assert.equal(same.status, 200, same.data && same.data.error && same.data.error.message);
  assert.equal(same.headers.get("x-lumio-neural"), "ai");
  assert.deepEqual([(await sharp(same.data).metadata()).width, (await sharp(same.data).metadata()).height], [48, 32]);
  const notForced = await c.call("POST", "/api/process?scale=1&neural=1&format=png", { raw: small, headers: { "content-type": "image/png" } });
  assert.equal(notForced.headers.get("x-lumio-neural"), "not-needed");
  const big = await png(100, 80, { r: 1, g: 2, b: 3 });
  const r = await c.call("POST", "/api/process?target=160&neural=1&format=png", { raw: big, headers: { "content-type": "image/png" } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-lumio-neural"), "too-large");
});

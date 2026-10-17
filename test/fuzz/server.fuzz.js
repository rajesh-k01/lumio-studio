const sharp = require("sharp");
const { loadConfig } = require("../../server/config");
const { openDb } = require("../../server/db");
const { createApp } = require("../../server/app");
const cfg = loadConfig({ dbFile: ":memory:", scryptN: 1024 }), db = openDb(":memory:"), { app } = createApp(cfg, db);
const problems = [], seen = {};
const note = (m) => { if (!seen[m]) { seen[m] = 1; problems.push(m); } };
process.on("uncaughtException", (e) => note("UNCAUGHT " + e.message));
process.on("unhandledRejection", (e) => note("UNHANDLED " + (e && e.message)));
function mkClient(base) {
  let cookie = "";
  return async (method, path, o = {}) => {
    const headers = Object.assign({ "x-requested-with": "lumio" }, o.headers || {});
    if (cookie) headers.cookie = cookie;
    let body; if (o.json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(o.json); } if (o.raw !== undefined && method !== "GET" && method !== "HEAD") body = o.raw;
    if (o.noCsrf) delete headers["x-requested-with"];
    let res; try { res = await fetch(base + path, { method, headers, body }); } catch (e) { note(`FETCH-ERR ${method} ${path}: ${e.message}`); return { status: 0 }; }
    (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((c) => { const kv = c.split(";")[0]; cookie = kv.endsWith("=") ? "" : kv; });
    const buf = Buffer.from(await res.arrayBuffer()); let data = null; try { data = JSON.parse(buf.toString()); } catch (_) {}
    if (res.status >= 500 && res.status !== 501) note(`5xx ${res.status} ${method} ${path} ${o.label || ""} -> ${buf.toString().slice(0, 120)}`);
    return { status: res.status, data, buf, headers: res.headers };
  };
}
(async () => {
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = "http://127.0.0.1:" + server.address().port;
  const A = mkClient(base), B = mkClient(base), anon = mkClient(base);
  const good = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#789" } }).png().toBuffer();
  let r;
  // ---- auth fuzz
  const junkBodies = [undefined, null, 5, "str", [], {}, { email: 1, password: 2, name: 3 }, { email: "a@b.c", password: "x" }, { email: "x".repeat(5000) + "@a.com", password: "longenough1", name: "n" }, { email: "ok@x.com", password: "p".repeat(100000), name: "n" }, { email: "ok2@x.com", password: "longenough1", name: { $ne: 1 } }, { email: ["a@b.com"], password: "longenough1", name: "n" }, { email: "a@b.com\r\nX: y", password: "longenough1", name: "n" }, JSON.parse('{"__proto__":{"vip":true},"email":"p@x.com","password":"longenough1","name":"n"}')];
  for (const j of junkBodies) { await anon("POST", "/api/auth/register", { json: j, label: "register" }); await anon("POST", "/api/auth/login", { json: j, label: "login" }); }
  r = await anon("POST", "/api/auth/register", { raw: "{bad json", headers: { "content-type": "application/json" } }); if (r.status !== 400) note("bad JSON register -> " + r.status);
  r = await anon("POST", "/api/auth/register", { json: { email: "a@x.com", password: "correct horse", name: "A" }, noCsrf: true }); if (r.status < 400) note("CSRF header not enforced on register: " + r.status);
  r = await A("POST", "/api/auth/register", { json: { email: "a1@example.com", password: "correct horse", name: "Asha" } }); if (r.status !== 201) note("register failed " + r.status);
  r = await B("POST", "/api/auth/register", { json: { email: "b1@example.com", password: "correct horse", name: "Bob" } });
  r = await A("POST", "/api/auth/register", { json: { email: "A1@EXAMPLE.com", password: "correct horse", name: "dup" } }); if (r.status === 201) note("duplicate email (case variant) accepted");
  const me = await A("GET", "/api/auth/me"); if (me.data && me.data.user && me.data.user.password_hash) note("password hash leaked in /me");
  if (JSON.stringify(me.data).match(/scrypt|hash|salt/i)) note("sensitive field names in /me: " + JSON.stringify(me.data).slice(0, 150));
  await A("POST", "/api/vip/claim"); await B("POST", "/api/vip/claim");
  const accts = db.prepare("select email from users").all().map((x) => x.email); console.log("accounts created by junk loop:", JSON.stringify(accts));
  const anon2 = mkClient(base);
  { const u = db.prepare("select * from users where email=?").get("p@x.com"); console.log("proto-register user vip flag:", u && (u.vip === undefined ? "n/a" : u.vip), "keys:", u && Object.keys(u).join(",")); }
  // ---- unauth access to protected routes
  for (const [m, p] of [["GET", "/api/projects"], ["POST", "/api/projects"], ["GET", "/api/projects/1"], ["GET", "/api/formulas"], ["POST", "/api/process"], ["POST", "/api/cutout"], ["POST", "/api/video/enhance"], ["POST", "/api/vip/claim"], ["DELETE", "/api/auth/account"]]) {
    const x = await anon2(m, p, { raw: good, headers: { "content-type": "image/png" } }); if (x.status !== 401 && x.status !== 403 && x.status !== 404) note(`unauth ${m} ${p} -> ${x.status}`);
  }
  // ---- projects: junk + IDOR
  for (const j of [undefined, {}, { name: 5 }, { name: "x".repeat(10000) }, { name: "<script>alert(1)</script>", mode: "photo" }, { mode: "hack" }, { settings: "str" }, { settings: { denoise: "NaN", style: "../../etc/passwd", filter: {} } }, { thumb: "javascript:alert(1)" }, { thumb: "data:image/png;base64," + "A".repeat(2e5) }]) { r = await A("POST", "/api/projects", { json: j, label: JSON.stringify(j || "").slice(0, 40) }); }
  r = await A("POST", "/api/projects", { json: { name: "secret", mode: "photo" } }); const pid = r.data && r.data.project && r.data.project.id;
  if (!pid) note("could not create project: " + r.status);
  else {
    await A("PUT", `/api/projects/${pid}/image`, { raw: good, headers: { "content-type": "image/png" } });
    for (const [m, p, o] of [["GET", `/api/projects/${pid}`], ["GET", `/api/projects/${pid}/image`], ["PUT", `/api/projects/${pid}`, { json: { name: "pwn" } }], ["DELETE", `/api/projects/${pid}`], ["PUT", `/api/projects/${pid}/image`, { raw: good, headers: { "content-type": "image/png" } }]]) {
      const x = await B(m, p, o); if (x.status < 400) note(`IDOR: other user ${m} ${p} -> ${x.status}`);
    }
    const list = await B("GET", "/api/projects"); if (list.data && JSON.stringify(list.data).includes("secret")) note("IDOR: project listed for other user");
    await A("PUT", `/api/projects/${pid}/image`, { raw: Buffer.from("not an image"), headers: { "content-type": "image/png" } });
    await A("PUT", `/api/projects/${pid}/image`, { raw: Buffer.alloc(0), headers: { "content-type": "image/png" } });
    await A("PUT", `/api/projects/${pid}/image`, { raw: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>"), headers: { "content-type": "image/svg+xml" } });
  }
  for (const id of ["abc", "-1", "0", "1e99", "99999999999999999999", "%00", "1;DROP TABLE users", "../../x", "NaN", "0x10"]) for (const m of ["GET", "PUT", "DELETE"]) await A(m, "/api/projects/" + encodeURIComponent(id), { json: m === "PUT" ? { name: "x" } : undefined, label: id });
  // ---- formulas
  for (const j of [undefined, {}, { name: "n" }, { name: "n", settings: "x" }, { name: "n".repeat(9999), settings: {} }, { name: "ok", settings: { denoise: 1e99 } }]) await A("POST", "/api/formulas", { json: j, label: JSON.stringify(j || "").slice(0, 40) });
  for (const c of ["", "x", "../..", "%", "A".repeat(500), "'; --"]) await anon("GET", "/api/formulas/public/" + encodeURIComponent(c));
  // ---- process / cutout: query + body fuzz
  const qs = ["", "?scale=0", "?scale=-5", "?scale=abc", "?scale=1e9", "?scale=NaN", "?scale=Infinity", "?target=0", "?target=-1", "?target=99999999", "?target=1e99", "?target=abc", "?format=gif", "?format=../x", "?format=jpeg&quality=0", "?format=webp&quality=1000", "?format=png&quality=NaN", "?scale=2&scale=3", "?target[]=1", "?target=2160&scale=8&format=avif"];
  for (const q of qs) { r = await A("POST", "/api/process" + q, { raw: good, headers: { "content-type": "image/png" }, label: q }); if (r.status === 200) { try { await sharp(r.buf).metadata(); } catch (e) { note("process output undecodable for " + q); } } }
  for (const h of [{}, { "x-lumio-settings": "%" }, { "x-lumio-settings": "not json" }, { "x-lumio-settings": encodeURIComponent("[]") }, { "x-lumio-settings": encodeURIComponent('{"__proto__":{"x":1}}') }, { "x-lumio-settings": encodeURIComponent(JSON.stringify({ denoise: "x", sharpen: 1e99, filter: "../x", style: "a" })) }, { "x-lumio-settings": "x".repeat(60000) }]) await A("POST", "/api/process", { raw: good, headers: Object.assign({ "content-type": "image/png" }, h), label: JSON.stringify(h).slice(0, 50) });
  const bodies = { empty: Buffer.alloc(0), text: Buffer.from("hello"), truncatedPng: good.subarray(0, 30), pngHeaderOnly: good.subarray(0, 8), randomBytes: Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 131 + 7) & 255)), svg: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><image href='file:///etc/passwd'/></svg>"), onePx: await sharp({ create: { width: 1, height: 1, channels: 3, background: "#fff" } }).png().toBuffer(), wide: await sharp({ create: { width: 3000, height: 1, channels: 3, background: "#f00" } }).png().toBuffer(), tall: await sharp({ create: { width: 1, height: 3000, channels: 3, background: "#f00" } }).png().toBuffer(), gifAnim: await sharp({ create: { width: 8, height: 8, channels: 3, background: "#0f0" } }).gif().toBuffer(), alphaPng: await sharp({ create: { width: 9, height: 9, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer() };
  // decompression bomb: huge dimensions, tiny file
  try { bodies.bomb = await sharp({ create: { width: 16000, height: 16000, channels: 3, background: "#000" } }).png({ compressionLevel: 9 }).toBuffer(); } catch (e) { note("could not build bomb: " + e.message); }
  for (const [k, b] of Object.entries(bodies)) for (const ep of ["/api/process", "/api/process?target=4320", "/api/cutout", "/api/ai/upscale?scale=2"]) { r = await A("POST", ep, { raw: b, headers: { "content-type": "image/png" }, label: k }); }
  for (const ct of ["application/json", "text/plain", "", "image/png; charset=\"", "multipart/form-data"]) await A("POST", "/api/process", { raw: good, headers: { "content-type": ct }, label: "ct=" + ct });
  // ---- video route
  for (const [k, b, ct] of [["empty", Buffer.alloc(0), "video/mp4"], ["garbage", Buffer.from("not a video at all"), "video/mp4"], ["png-as-video", good, "video/mp4"], ["wrong ct", good, "image/png"]]) for (const q of ["", "?target=99999", "?target=-4", "?speed=0", "?speed=-1", "?speed=1e9", "?start=1e9&end=-1", "?start=abc", "?mirror=1&target=4320"]) { r = await A("POST", "/api/video/enhance" + q, { raw: b, headers: { "content-type": ct }, label: k + q }); }
  // ---- methods, routes, headers
  for (const [m, p] of [["OPTIONS", "/api/process"], ["PATCH", "/api/projects/1"], ["GET", "/api/%E0%A4%A"], ["GET", "/api/../etc/passwd"], ["GET", "/..%2f..%2fetc/passwd"], ["GET", "/%2e%2e/%2e%2e/etc/passwd"], ["GET", "/server/config.js"], ["GET", "/data/lumio.db"], ["GET", "/.env"], ["GET", "/package.json"]]) { r = await anon(m, p); if (r.status === 200 && /\/(etc|server|data|\.env|package)/.test(p) && !/index|<html/i.test((r.buf || "").toString().slice(0, 200))) note(`file exposure? ${m} ${p} -> 200 ${String(r.buf).slice(0, 60)}`); }
  r = await anon("GET", "/api/health", { headers: { cookie: "lumio_session=" + "A".repeat(10000) } }); r = await anon("GET", "/api/auth/me", { headers: { cookie: "lumio_session=';DROP TABLE sessions;--; x=%" } });
  // ---- security headers
  r = await anon("GET", "/api/health"); for (const h of ["x-content-type-options", "content-security-policy"]) if (!r.headers.get(h)) note("missing header " + h);
  // ---- rate limit check on login
  let limited = false; for (let i = 0; i < 40; i++) { r = await anon("POST", "/api/auth/login", { json: { email: "a1@example.com", password: "wrong" + i } }); if (r.status === 429) { limited = true; break; } } if (!limited) note("login brute force not rate limited in 40 tries");
  // ---- server still alive?
  r = await anon("GET", "/api/health"); if (r.status !== 200) note("server unhealthy after fuzz: " + r.status);
  console.log("problems:", problems.length); problems.forEach((p) => console.log(" -", p));
  server.close(); db.close(); setTimeout(() => process.exit(0), 200);
})().catch((e) => { console.log("HARNESS ERROR", e); process.exit(1); });

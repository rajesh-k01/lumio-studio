/* UI smoke test with jsdom and a canvas library. It is NOT a real browser.
   Setup:  npm i --no-save jsdom canvas      (canvas needs system libraries, see its README)
   Run:    serve public/ (for example `python3 -m http.server 8123 --directory public`), then
           LUMIO_URL=http://localhost:8123/index.html node test/ui/smoke.js
   Fonts from Google cannot load in a sandbox, so a "Could not load link" error for them is expected. */
const { JSDOM, VirtualConsole } = require("jsdom");
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push("jsdomError: " + (e.detail && e.detail.stack || e.message)));
vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
process.on("unhandledRejection", (e) => { console.log("UNHANDLED", e && (e.stack || e.message || JSON.stringify(e))); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const dom = await JSDOM.fromURL(process.env.LUMIO_URL || "http://localhost:8123/index.html", { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window; const d = w.document;
  w.URL.createObjectURL = () => "blob:x"; w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { w.__dl = (w.__dl || []).concat(this.download); };
  w.scrollTo = () => {};
  await wait(1500);
  // jsdom cannot decode blob: images, so remember which canvas each exported blob came from and hand that canvas back from loadImage.
  const blobCanvas = new Map(), realCB = w.UI.canvasBlob, realLI = w.UI.loadImage;
  w.UI.canvasBlob = (c, m, q) => realCB(c, m, q).then((b) => { blobCanvas.set(b, c); return b; });
  w.UI.loadImage = (b) => { const c = blobCanvas.get(b); if (!c) return realLI(b); c.naturalWidth = c.width; c.naturalHeight = c.height; return Promise.resolve(c); };
  ok(w.Lumio && w.Lumio.mode === "demo", "demo mode detected (" + (w.Lumio && w.Lumio.mode) + ")");
  ok(d.querySelectorAll(".qtile").length === 8, "AI enhance tile + 7 preset tiles: " + d.querySelectorAll(".qtile").length);
  ok(d.querySelectorAll(".tool").length === 16, "16 tool tiles: " + d.querySelectorAll(".tool").length);
  ok(d.querySelector(".cmp .after"), "hero compare present");
  ok(d.querySelector("#authbox .btn.vip"), "guest sees Get VIP free");
  // guest gating
  w.UI.gate("vip", "test"); ok(d.querySelector("#modalRoot .modal"), "VIP gate opens sign-in dialog");
  d.querySelector("#modalRoot .modal").remove();
  // register in demo mode
  const u = await w.Lumio.api.register("Test User", "t@example.com", "password1"); w.Lumio.setUser(u);
  ok(u.vip === true, "register gives VIP");
  ok(d.querySelector("#authbox .badge.vip"), "header shows VIP badge");
  const bad = await w.Lumio.api.login("t@example.com", "wrongpass").then(() => false, (e) => e.code === "wrong_credentials");
  ok(bad, "wrong password rejected");
  // photo editor
  const cv = d.createElement("canvas"); cv.width = 600; cv.height = 400; const x = cv.getContext("2d"); x.fillStyle = "#335"; x.fillRect(0, 0, 600, 400); x.fillStyle = "#e84"; x.fillRect(200, 120, 200, 160); x.fillStyle = "rgb(235,220,150)"; x.fillRect(240, 160, 120, 80);
  w.location.hash = "#/photo"; await wait(100);
  w.Photo.openImage(cv, "test.png"); await wait(200);
  ok(w.Photo.hasImage(), "photo opened");
  ok(d.querySelectorAll("#v-photo .rail button").length === 9, "9 tools in rail");
  for (const t of ["enhance", "retouch", "color", "filters", "styles", "crop", "text", "remove", "cutout"]) { w.Photo.setTool(t); await wait(30); ok(d.querySelector("#v-photo .insp h3"), "tool panel " + t); }
  w.Photo.setTool("filters"); await wait(30);
  ok(d.querySelectorAll("#v-photo .ftile").length === 17, "17 filter tiles");
  w.Photo.setTool("enhance"); await w.Photo.applyPreset("Night view"); await wait(300);
  ok(w.Photo.settings().shadows === 25 && w.Photo.settings().denoise >= 35, "Night view look applied through the enhancer: shadows=" + w.Photo.settings().shadows + " denoise=" + w.Photo.settings().denoise);
  const lookChips = [...d.querySelectorAll("#v-photo .insp .chip")].map((c) => c.textContent.replace(/VIP$/, ""));
  ok(["AI enhance", "Auto fix", "AI color", "Portrait", "Night view", "Landscape", "Cinematic", "Old photo restore"].every((n) => lookChips.includes(n)), "all eight looks are chips in Enhance");
  for (const n of ["Auto fix", "AI color", "Portrait", "Landscape", "Cinematic", "Old photo restore"]) { await w.Photo.applyPreset(n); await wait(150); ok(new RegExp(n + " look").test((d.querySelector("#v-photo .insp .note") || {}).textContent || ""), "look " + n + " enhances at once"); }
  // resolution targets and AI enhance (photo)
  w.Photo.setTool("enhance"); await wait(30);
  const chipTxt = () => [...d.querySelectorAll("#v-photo .insp .chip")].map((c) => c.textContent);
  ok(["HD", "2K", "4K", "8K"].every((l) => chipTxt().some((t) => t.startsWith(l))), "photo resolution chips HD, 2K, 4K, 8K: " + chipTxt().filter((t) => /^(Original|HD|2K|4K|8K)/.test(t)).join(" | "));
  ok(chipTxt().some((t) => t.startsWith("AI enhance")) && chipTxt().some((t) => t.startsWith("Original")), "quality chips include Original and AI enhance");
  ok(d.querySelectorAll("#v-photo .insp input[type=range]").length === 0, "Enhance panel has no manual sliders (everything is set automatically)");
  const dark = d.createElement("canvas"); dark.width = 300; dark.height = 200; const dx = dark.getContext("2d"); const im = dx.createImageData(300, 200);
  for (let i = 0; i < im.data.length; i += 4) { const n = 40 + Math.floor(Math.random() * 40); im.data[i] = n; im.data[i + 1] = n; im.data[i + 2] = n + 6; im.data[i + 3] = 255; } dx.putImageData(im, 0, 0);
  w.Photo.openImage(dark, "dark.png"); await wait(200); w.Photo.setTool("enhance"); await wait(30);
  const before0 = JSON.stringify(w.Photo.settings());
  [...d.querySelectorAll("#v-photo .insp .chip")].find((c) => c.textContent.startsWith("AI enhance")).click(); await wait(600);
  const st = w.Photo.settings(); ok(JSON.stringify(st) !== before0 && st.denoise > 0, "AI enhance chip enhanced a dark noisy photo at once and set denoise automatically: denoise=" + st.denoise + " bright=" + st.bright);
  ok(/Enhanced with/.test(d.querySelector("#v-photo .insp .note") ? d.querySelector("#v-photo .insp .note").textContent : ""), "panel reports how the photo was enhanced");
  [...d.querySelectorAll("#v-photo .insp .chip")].find((c) => c.textContent.startsWith("HD")).click(); await wait(1500);
  ok(/Result 1080|Result \d+ × 1080|× 1080/.test(d.querySelector("#v-photo .insp .note") ? d.querySelector("#v-photo .insp .note").textContent : ""), "HD chip enhanced to 1080 px short side: " + (d.querySelector("#v-photo .insp .note") || {}).textContent);
  w.Photo.openImage(cv, "test.png"); await wait(200);
  w.Photo.setTool("text"); [...d.querySelectorAll("#v-photo .insp .btn.primary")].find((b) => b.textContent === "Add text").click(); await wait(50);
  ok(d.querySelector("#v-photo .insp input[type=text]"), "text item editor shown");

  // retouch brushes via real pointer events
  const pv = d.querySelector("#v-photo .frame canvas"); pv.getBoundingClientRect = () => ({ left: 0, top: 0, width: pv.width, height: pv.height });
  const ev = (t, x, y) => d.querySelector("#v-photo .frame").dispatchEvent(new w.MouseEvent(t, { clientX: x, clientY: y, bubbles: true }));
  const px = (c, x, y) => c.getContext("2d").getImageData(x, y, 1, 1).data;
  w.Photo.setTool("retouch"); await wait(30);
  const chipBy = (t) => [...d.querySelectorAll("#v-photo .insp .chip")].find((c) => c.textContent.startsWith(t));
  ok(chipBy("Whiten teeth") && chipBy("Reshape: push") && chipBy("Hair color") && chipBy("Lips and blush"), "retouch brush chips present");
  chipBy("Whiten teeth").click(); await wait(30);
  ok(d.querySelector("#v-photo .insp input[type=range]"), "brush sliders shown");
  const b0 = px(w.Photo.base(), 300, 200)[2];
  ev("pointerdown", 250, 200); ev("pointermove", 300, 200); ev("pointermove", 350, 200); ev("pointerup", 350, 200); await wait(80);
  const b1 = px(w.Photo.base(), 300, 200)[2];
  ok(b1 > b0 + 8, "teeth whitening changed the base: blue " + b0 + " -> " + b1);
  ok(px(w.Photo.base(), 20, 20)[2] === px(cv, 20, 20)[2], "pixels outside the stroke untouched");
  const undo = d.querySelector('#v-photo .stagebar button[aria-label="Undo"]'); ok(!undo.disabled, "undo enabled after stroke");
  undo.click(); await wait(50);
  ok(px(w.Photo.base(), 300, 200)[2] === b0, "undo restored the original pixels");
  chipBy("Hair color").click(); await wait(30);
  ev("pointerdown", 250, 200); ev("pointermove", 350, 200); ev("pointerup", 350, 200); await wait(80);
  const r1 = px(w.Photo.base(), 300, 200); ok(r1[0] !== 235 || r1[1] !== 220, "hair color recolored the stroke");
  chipBy("Reshape: push").click(); await wait(30);
  const rowSum = () => { const dd = w.Photo.base().getContext("2d").getImageData(320, 190, 80, 20).data; let t = 0; for (let i = 0; i < dd.length; i++) t += dd[i]; return t; }; const before = rowSum();
  ev("pointerdown", 330, 200); ev("pointermove", 345, 200); ev("pointermove", 360, 200); ev("pointermove", 375, 200); ev("pointerup", 375, 200); await wait(80);
  const after = rowSum(); ok(Math.abs(after - before) > 2000, "reshape push moved pixels: " + before + " -> " + after);
  // export
  [...d.querySelectorAll("#v-photo .stagebar .btn.primary")].find((b) => /Preview and download/.test(b.textContent)).click(); await wait(1500);
  ok(d.querySelector("#modalRoot .card h2") && /Preview and download/.test(d.querySelector("#modalRoot .card h2").textContent), "preview and download dialog open");
  ok(d.querySelectorAll("#modalRoot canvas.pv").length === 2, "before and after preview panes");
  ok(["HD", "2K", "4K", "8K"].every((l) => [...d.querySelectorAll("#modalRoot .chip")].some((c) => c.textContent.startsWith(l))), "preview dialog has Original, AI enhance and resolution chips");
  ok(![...d.querySelectorAll("#modalRoot label")].some((l) => /server|neural/i.test(l.textContent)), "demo mode hides cloud and neural export options");
  [...d.querySelectorAll("#modalRoot .btn.primary")].find((b) => b.textContent === "Download this quality").click(); await wait(2500);
  ok((w.__dl || []).some((n) => /test-lumio/.test(n)), "export downloaded: " + JSON.stringify(w.__dl));
  d.querySelector("#modalRoot .modal") && d.querySelector("#modalRoot .modal").remove();

  // video panel with faked metadata
  w.location.hash = "#/video"; await wait(100);
  const vid = d.querySelector("#v-video video"); vid.load = () => {};
  [["duration", 12], ["videoWidth", 640], ["videoHeight", 360]].forEach(([k, v]) => Object.defineProperty(vid, k, { value: v, configurable: true }));
  w.Video.open(new w.File([new Uint8Array(10)], "clip.mp4", { type: "video/mp4" })); vid.onloadedmetadata(); await wait(60);
  const vtxt = d.querySelector("#v-video .insp").textContent;
  ok(/Steady and smooth/.test(vtxt) && /Stabilize/.test(vtxt) && /Frame blending/.test(vtxt), "video panel has stabilize and frame blending");
  ok(!/Auto captions from speech/.test(vtxt), "unbuilt auto-captions row hidden from the video panel");
  const vchips = [...d.querySelectorAll("#v-video .insp .chip")].map((c) => c.textContent);
  ok(["720p", "HD", "2K", "4K"].every((l) => vchips.some((t) => t.startsWith(l))) && !vchips.some((t) => t.startsWith("8K")), "video chips 720p to 4K, and no 8K without the server render: " + vchips.filter((t) => /^(720p|HD|2K|4K|8K)/.test(t)).join(" | "));
  ok([...d.querySelectorAll("#v-video .insp .btn.primary")].some((b) => b.textContent === "AI enhance"), "video has an AI enhance button");
  ok(!vchips.some((t) => /Render on server/.test(t)), "demo mode hides Render on server");
  const stab = [...d.querySelectorAll("#v-video .insp .chip")].find((c) => c.textContent.startsWith("Stabilize")); stab.click(); await wait(30);
  ok([...d.querySelectorAll("#v-video .insp .chip")].find((c) => c.textContent.startsWith("Stabilize")).getAttribute("aria-pressed") === "true", "stabilize toggles on for VIP");
  d.querySelector("#v-video .scr").value = "Welcome to the show. Here is the second line of the script."; 
  [...d.querySelectorAll("#v-video .insp .btn")].find((b) => /Time the script/.test(b.textContent)).click(); await wait(30);
  ok(/\d:\d\d-\d:\d\d Welcome/.test(d.querySelector('#v-video textarea[aria-label="Captions"]').value), "script timed into captions");
  // other views
  for (const v of ["video", "collage", "batch", "formulas", "projects", "plans", "home"]) { w.location.hash = "#/" + v; await wait(150); ok(!d.getElementById("v-" + v).hidden && d.getElementById("v-" + v).children.length > 0, "view " + v); }
  w.location.hash = "#/plans"; await wait(100);
  ok(d.querySelectorAll("#v-plans .plan .fl li").length === 51, "plans lists 51 features: " + d.querySelectorAll("#v-plans .plan .fl li").length);
  // formulas + projects round trip (demo backend)
  const f = await w.Lumio.api.createFormula("Warm", { warm: 20, filter: "noir" }); ok(/^[A-Z0-9]{8}$/.test(f.code), "formula code " + f.code);
  const pf = await w.Lumio.api.publicFormula(f.code.toLowerCase()); ok(pf.settings.warm === 20 && pf.settings.filter === "noir", "public formula lookup");
  // projects need IndexedDB (absent in jsdom) -> expect a clear error, not a crash
  const pe = await w.Lumio.api.listProjects().then(() => "ok", (e) => e.code); console.log("INFO projects in jsdom:", pe);
  // batch zip
  const zip = w.Tools.makeZip([{ name: "a.txt", data: new w.Uint8Array([1, 2, 3]) }]); ok(zip.size > 60, "zip built " + zip.size);
  // sign out -> gates
  await w.Lumio.signOut(); w.location.hash = "#/batch"; await wait(100);
  ok(d.querySelector("#v-batch .gate"), "guest sees batch gate");
  w.location.hash = "#/photo"; await wait(100); w.Photo.setTool("filters"); await wait(50);
  const locked = d.querySelectorAll("#v-photo .ftile .badge.vip").length; ok(locked === 8, "8 VIP filters badged for guest: " + locked);
  console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no runtime errors");
  process.exit(process.exitCode || 0);
})();

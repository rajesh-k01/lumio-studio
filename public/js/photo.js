/* Photo editor: pipeline, history, tool panels, export, cloud save. */
(function () {
  "use strict";
  var U = window.UI, L = window.Lumio, E = window.LumioEngine, F = window.LumioFeatures, el = U.el;

  var MAX_EDIT = 4096, PREVIEW = 1100, MAX_PX = 36e6;
  var RATIOS = { orig: null, "1:1": 1, "4:5": 0.8, "3:4": 0.75, "3:2": 1.5, "16:9": 16 / 9, "9:16": 9 / 16 };
  var FONTS = { sans: "'Figtree','Segoe UI',system-ui,sans-serif", display: "'Bricolage Grotesque','Segoe UI',system-ui,sans-serif", serif: "Georgia,'Times New Roman',serif", mono: "ui-monospace,Menlo,Consolas,monospace" };
  var COLORS = ["#ffffff", "#15121d", "#ffc15a", "#9d8cff", "#6fe0c5", "#ff8a98", "#ff5d5d", "#5db5ff"];
  var STICKERS = ["✨", "❤️", "🔥", "😍", "😎", "🌸", "🌟", "🎉", "💫", "🌈", "☀️", "🌙", "🍀", "🦋", "🎵", "👑", "💎", "📍"];
  var TOOLS = [
    { id: "enhance", label: "Enhance" }, { id: "retouch", label: "Retouch" }, { id: "color", label: "Light", icon: "color" },
    { id: "filters", label: "Filters" }, { id: "styles", label: "Styles" }, { id: "crop", label: "Crop" },
    { id: "text", label: "Text" }, { id: "remove", label: "Remove", vip: true }, { id: "cutout", label: "Cutout", vip: true }
  ];

  function defTf() { return { rot: 0, fx: false, fy: false, ratio: "orig", zoom: 0, px: 0, py: 0 }; }
  var S = { base: null, rotC: null, name: "photo", settings: E.sanitize({}), tf: defTf(), items: [], sel: -1, tool: "enhance",
    hist: [], hi: -1, alpha: false, res: "orig", lvl: "orig", look: "AI enhance", cache: {}, cacheKeys: [], viewImg: null, viewKey: "", status: "", split: false, splitAt: 0.5, holding: false, projectId: null, stamp: 0 };
  var R = { mode: null, color: "#d6336c", amt: 60, size: 40 }, B = null;
  var D = { sliders: {} }, brush = { size: 28, down: false }, tol = 28, mounted = false, pending = false;

  function mk(w, h) { var c = document.createElement("canvas"); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function neutral(s) {
    for (var k in E.LIMITS) { if (k === "fstr" || k === "sstr") continue; if (s[k]) return false; }
    return s.filter === "none" && s.style === "none";
  }
  function tfIsDefault() { var t = S.tf; return !t.rot && !t.fx && !t.fy && t.ratio === "orig" && !t.zoom && !t.px && !t.py; }

  /* ---------- geometry ---------- */
  function rotCanvas() {
    if (S.rotC) return S.rotC;
    if (!S.tf.rot && !S.tf.fx && !S.tf.fy) return S.base;
    var b = S.base, r = S.tf.rot, sw = r % 180 !== 0, c = mk(sw ? b.height : b.width, sw ? b.width : b.height), x = c.getContext("2d");
    x.translate(c.width / 2, c.height / 2); x.rotate(r * Math.PI / 180); x.scale(S.tf.fx ? -1 : 1, S.tf.fy ? -1 : 1);
    x.drawImage(b, -b.width / 2, -b.height / 2);
    return (S.rotC = c);
  }
  function cropRect() {
    var rc = rotCanvas(), rw = rc.width, rh = rc.height, r = RATIOS[S.tf.ratio], cw = rw, ch = rh;
    if (r) { cw = Math.min(rw, rh * r); ch = cw / r; }
    var f = 1 + S.tf.zoom / 50; cw /= f; ch /= f;
    var cx = rw / 2 + (S.tf.px / 100) * (rw - cw) / 2, cy = rh / 2 + (S.tf.py / 100) * (rh - ch) / 2;
    return { sx: Math.round(cx - cw / 2), sy: Math.round(cy - ch / 2), cw: Math.max(1, Math.round(cw)), ch: Math.max(1, Math.round(ch)) };
  }
  function resample(src, cr, ow, oh) {
    var cur = src, sx = cr.sx, sy = cr.sy, cw = cr.cw, ch = cr.ch;
    while (ow > cw * 2.0001) {
      var nw = Math.round(cw * 2), nh = Math.round(ch * 2), c = mk(nw, nh), x = c.getContext("2d");
      x.imageSmoothingQuality = "high"; x.drawImage(cur, sx, sy, cw, ch, 0, 0, nw, nh);
      cur = c; sx = 0; sy = 0; cw = nw; ch = nh;
    }
    var out = mk(ow, oh), ox = out.getContext("2d");
    ox.imageSmoothingQuality = "high"; ox.drawImage(cur, sx, sy, cw, ch, 0, 0, ow, oh);
    return out;
  }
  function transformed(maxSide, scale) {
    var cr = cropRect(), s = scale || Math.min(1, maxSide / Math.max(cr.cw, cr.ch));
    return resample(rotCanvas(), cr, Math.max(1, Math.round(cr.cw * s)), Math.max(1, Math.round(cr.ch * s)));
  }
  function outDims(scale) { var cr = cropRect(); return [Math.round(cr.cw * scale), Math.round(cr.ch * scale)]; }
  /* Resolution targets are named by the short side: HD 1080, 2K 1440, 4K 2160, 8K 4320. */
  function scaleFor(id) { var r = F.resById(F.RESOLUTIONS, id); if (!r.short) return 1; var cr = cropRect(); return r.short / Math.min(cr.cw, cr.ch); }
  function curScale() { return scaleFor(S.res); }
  /* Quality levels. Picking one enhances the photo right away and sets noise, sharpness, color and skin automatically. */
  var LEVELS = ["orig", "ai", "hd", "2k", "4k", "8k"];
  function levelDef(id) { return id === "ai" ? { id: "ai", label: "AI enhance", short: 0, tier: "free" } : F.resById(F.RESOLUTIONS, id); }
  function levelScale(id) { return id === "ai" || id === "orig" ? 1 : scaleFor(id); }
  function serverAI() { return L.mode === "server" && !!(L.health && L.health.ai) && L.isVip(); }
  function curKey(id) { return [id, S.stamp, JSON.stringify(S.settings), serverAI() ? 1 : 0].join("|"); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function skinFraction(d, n) {
    var c = 0;
    for (var i = 0; i < d.length; i += 4) {
      var r = d[i], g = d[i + 1], b = d[i + 2], cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      if (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173 && r > b && r + g + b > 90) c++;
    }
    return c / Math.max(1, n);
  }
  var AUTO_LABELS = [["natural", "Natural finish"], ["denoise", "Noise reduction"], ["sharpen", "Sharpen"], ["clarity", "Clarity"], ["dehaze", "Dehaze"], ["autowb", "Color balance"], ["contrast", "Contrast"], ["skin", "Skin smoothing"]];
  /* Measure the photo and choose every Fix and Retouch value for the chosen quality. Filter and style are kept. */
  function autoSettings(id, look) {
    var keep = { filter: S.settings.filter, fstr: S.settings.fstr, style: S.settings.style, sstr: S.settings.sstr };
    if (id === "orig") return { settings: E.sanitize(keep), notes: [] };
    var t = transformed(512), px = t.getContext("2d").getImageData(0, 0, t.width, t.height), r = E.aiEnhance(px.data, t.width, t.height), st = Object.assign({}, r.settings);
    var lvl = { ai: 1, hd: 1, "2k": 2, "4k": 3, "8k": 4 }[id] || 1, sf = skinFraction(px.data, t.width * t.height);
    st.sharpen = clamp(Math.round(st.sharpen + lvl * 2), 0, 100); st.clarity = clamp(Math.round(st.clarity + lvl * 2), 0, 100);
    st.skin = sf > 0.03 ? Math.round(clamp(20 + sf * 250, 20, 50) * (serverAI() ? 0.4 : 1)) : 0; // the AI face step already smooths skin
    st.glow = 0; st.tilt = 0; st.natural = 100; // tone and colour finish fitted on a reference result; the server adds its detail part when it uses the AI
    return { settings: E.sanitize(withLook(Object.assign(st, keep), look || S.look)), notes: r.notes };
  }
  /* Looks: every look works with every quality. The measured fixes decide noise and detail (so clarity stays natural);
     the look decides tone, colour, filter, vignette and grain. */
  var LOOKS = ["AI enhance", "Auto fix", "AI color", "Portrait", "Night view", "Landscape", "Cinematic", "Old photo restore"];
  var LOOK_KEYS = ["contrast", "sat", "warm", "bright", "shadows", "highlights", "dehaze", "autowb", "skin", "glow", "tilt", "vignette", "grain", "filter", "fstr", "style", "sstr"];
  function withLook(base, look) {
    if (look === "AI enhance" || !E.PRESETS[look]) return base;
    var pr = E.PRESETS[look], out = Object.assign({}, base);
    LOOK_KEYS.forEach(function (k) { if (pr[k] !== undefined) out[k] = pr[k]; });
    if (pr.skin !== undefined && serverAI()) out.skin = Math.round(pr.skin * 0.5); // the AI face step already smooths skin
    ["denoise"].forEach(function (k) { if (pr[k] !== undefined) out[k] = Math.max(out[k], Math.round(pr[k] * 0.5)); });
    ["sharpen", "clarity"].forEach(function (k) { if (pr[k] !== undefined) out[k] = clamp(Math.round(out[k] + pr[k] * 0.4), 0, 100); }); // only used without the AI; the AI path drops them
    return out;
  }
  function trimCache() { while (S.cacheKeys.length > 3) { var k = S.cacheKeys.shift(); delete S.cache[k]; } }
  function localEnhance(id) {
    var sc = levelScale(id), c = transformed(0, sc), x = c.getContext("2d"), st = Object.assign({}, S.settings);
    if (sc > 1) st.sharpen = Math.max(st.sharpen, 35);
    return U.nextFrame().then(function () {
      if (!neutral(st)) { var d = x.getImageData(0, 0, c.width, c.height); E.enhance(d, c.width, c.height, st); x.putImageData(d, 0, 0); }
      return U.canvasBlob(c, "image/png");
    }).then(function (b) { return { blob: b, neural: "local" }; });
  }
  function serverEnhance(id) {
    var tgt = id === "ai" || id === "orig" ? 0 : levelDef(id).short;
    return U.canvasBlob(transformed(0, 1), "image/png").then(function (b) {
      return L.api.render(b, S.settings, { target: tgt, scale: 1, format: "png", neural: true, force: id === "ai", faces: L.health.faces ? 0.7 : 0 });
    }).then(function (r) { return { blob: r.blob, neural: r.neural }; });
  }
  var NEURAL_TEXT = { "ai+faces": "AI neural upscale with natural faces", ai: "AI neural upscale", local: "Lumio standard enhancer (sign in as VIP, on a server with the AI worker, for neural quality)",
    "too-large": "Standard enhancer (this photo is above the server's AI size limit)", "not-needed": "Standard enhancer (this photo is already larger than the chosen size, so no AI upscale was needed)", unavailable: "Standard enhancer (the AI worker is off on this server)", off: "Standard enhancer" };
  /* Enhance the photo for a quality level. Results are cached, so going back to a level you already made is instant. */
  function enhanceTo(id, look) {
    if (!S.base) return Promise.resolve(null);
    var def = levelDef(id), od = outDims(levelScale(id));
    if (!U.gate(def.tier, def.label + " output is a VIP option.")) return Promise.resolve(null);
    if (od[0] * od[1] > MAX_PX) { U.toast("That size is over the browser limit of " + Math.round(MAX_PX / 1e6) + " megapixels.", "err"); return Promise.resolve(null); }
    if (look && !U.gate(F.PRESET_TIERS[look], look + " is a VIP look.")) return Promise.resolve(null);
    if (look) S.look = look;
    var a = autoSettings(id);
    S.settings = a.settings; S.res = id === "ai" ? "orig" : id; S.lvl = id; pushHist();
    var key = curKey(id), hit = S.cache[key], b = hit ? null : U.busy("Enhancing" + (id === "orig" ? "" : " to " + def.label + (id === "ai" ? "" : " (" + od[0] + " × " + od[1] + ")")) + "…");
    var job = hit ? Promise.resolve(hit) : U.nextFrame().then(function () { return id === "orig" ? localEnhance(id) : (serverAI() ? serverEnhance(id) : localEnhance(id)); }).then(function (e) {
      e.key = key; e.id = id; e.notes = a.notes; S.cache[key] = e; S.cacheKeys.push(key); trimCache(); return e;
    });
    return job.then(function (e) {
      return U.loadImage(e.blob).then(function (im) {
        e.w = im.naturalWidth; e.h = im.naturalHeight; S.viewImg = im; S.viewKey = key;
        S.status = id === "orig" ? "Original photo, no enhancement." : S.look + " look. Enhanced with " + (NEURAL_TEXT[e.neural] || NEURAL_TEXT.off) + ". Result " + e.w + " × " + e.h + " px.";
        if (b) b.done(); buildInsp(); schedule(); return e;
      });
    }).catch(function (err) { if (b) b.done(); U.fail(err); return null; });
  }
  function aiEnhance() { return enhanceTo(S.lvl === "orig" ? "ai" : S.lvl, "AI enhance"); }
  function invalidate() { S.rotC = null; S.stamp++; }

  /* ---------- overlays ---------- */
  function drawItems(ctx, w, h, record) {
    S.items.forEach(function (it, i) {
      var px = it.size * h, x = it.x * w, y = it.y * h;
      ctx.save();
      ctx.font = (it.bold ? "700 " : "500 ") + px + "px " + FONTS[it.font || "sans"];
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      var tw = ctx.measureText(it.t).width;
      if (it.kind === "text" && it.outline) { ctx.lineWidth = Math.max(2, px * 0.12); ctx.strokeStyle = "rgba(0,0,0,.75)"; ctx.lineJoin = "round"; ctx.strokeText(it.t, x, y); }
      ctx.fillStyle = it.color || "#fff"; ctx.fillText(it.t, x, y);
      if (record) {
        it._b = { x: x - tw / 2, y: y - px / 2, w: tw, h: px };
        if (i === S.sel && S.tool === "text") { ctx.strokeStyle = "#9d8cff"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.strokeRect(it._b.x - 6, it._b.y - 4, tw + 12, px + 8); }
      }
      ctx.restore();
    });
  }

  /* ---------- render ---------- */
  function schedule() { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; render(); }); }
  function render() {
    if (!S.base || !D.cv) return;
    var t = transformed(PREVIEW), w = t.width, h = t.height, cv = D.cv, cx = cv.getContext("2d");
    [cv, D.cvO, D.mask].forEach(function (c) { if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } });
    var ox = D.cvO.getContext("2d"); ox.clearRect(0, 0, w, h); ox.drawImage(t, 0, 0); drawItems(ox, w, h, false);
    cx.clearRect(0, 0, w, h); cx.drawImage(t, 0, 0);
    if (S.viewImg && S.viewKey === curKey(S.lvl)) { cx.imageSmoothingQuality = "high"; cx.clearRect(0, 0, w, h); cx.drawImage(S.viewImg, 0, 0, w, h); }
    else if (!neutral(S.settings)) { var id = cx.getImageData(0, 0, w, h); E.enhance(id, w, h, S.settings); cx.putImageData(id, 0, 0); }
    drawItems(cx, w, h, true);
    var cr = cropRect(), od = outDims(curScale());
    D.info.textContent = cr.cw + " × " + cr.ch + " px" + (S.res !== "orig" ? " → export " + od[0] + " × " + od[1] : "") + (S.alpha ? " · transparent" : "");
    D.wrap.classList.toggle("checker", S.alpha);
    applyCompareView();
  }
  function applyCompareView() {
    if (!D.cvO) return;
    var showO = S.holding || S.split;
    D.cvO.style.visibility = showO ? "visible" : "hidden";
    D.cvO.style.clipPath = S.holding ? "none" : "inset(0 " + (100 - S.splitAt * 100) + "% 0 0)";
    D.divider.hidden = !(S.split && !S.holding);
    D.divider.style.left = (S.splitAt * 100) + "%";
  }

  /* ---------- history ---------- */
  function snap() { return { s: copy(S.settings), tf: copy(S.tf), items: copy(S.items.map(function (i) { var c = Object.assign({}, i); delete c._b; return c; })), base: S.base, alpha: S.alpha, sel: S.sel }; }
  function pushHist() {
    S.hist = S.hist.slice(0, S.hi + 1); S.hist.push(snap()); var cap = Math.max(5, Math.min(25, Math.floor(300e6 / (S.base.width * S.base.height * 4)))); while (S.hist.length > cap) S.hist.shift();
    S.hi = S.hist.length - 1; updateHistBtns();
  }
  function restore(i) {
    var h = S.hist[i]; if (!h) return;
    S.hi = i; S.settings = E.sanitize(h.s); S.tf = copy(h.tf); S.items = copy(h.items); S.sel = h.sel;
    if (S.base !== h.base) S.base = h.base; S.alpha = h.alpha; invalidate();
    updateHistBtns(); buildInsp(); schedule();
  }
  function updateHistBtns() { if (!D.undo) return; D.undo.disabled = S.hi <= 0; D.redo.disabled = S.hi >= S.hist.length - 1; }


  /* ---------- opening images ---------- */
  function openImage(im, name, opts) {
    opts = opts || {};
    var w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, s = Math.min(1, MAX_EDIT / Math.max(w, h)), c = mk(Math.round(w * s), Math.round(h * s)), x = c.getContext("2d");
    x.imageSmoothingQuality = "high"; x.drawImage(im, 0, 0, c.width, c.height);
    var probe = mk(48, 48).getContext("2d"); probe.drawImage(c, 0, 0, 48, 48);
    var d = probe.getImageData(0, 0, 48, 48).data, alpha = false;
    for (var i = 3; i < d.length; i += 4) if (d[i] < 250) { alpha = true; break; }
    S.base = c; S.alpha = alpha; S.name = (name || "photo").replace(/\.[^.]+$/, "").slice(0, 60) || "photo";
    S.tf = defTf(); S.items = []; S.sel = -1; S.rotC = null; S.stamp++; S.projectId = opts.projectId || null;
    S.settings = E.sanitize(opts.settings || {}); S.hist = []; S.hi = -1; S.lvl = "orig"; S.look = "AI enhance"; S.res = "orig"; S.cache = {}; S.cacheKeys = []; S.viewImg = null; S.viewKey = ""; S.status = ""; pushHist();
    if (s < 1) U.toast("Large photo resized to " + c.width + " × " + c.height + " for editing.");
    mount(); showEditor(true); buildRail(); buildInsp(); render();
  }
  function openFile(file, opts) {
    if (!file) return Promise.resolve();
    if (!/^image\//.test(file.type)) { U.toast("Choose an image file (JPEG, PNG or WebP).", "err"); return Promise.resolve(); }
    return U.loadImage(file).then(function (im) { openImage(im, file.name, opts); }).catch(U.fail);
  }

  /* ---------- DOM ---------- */
  function mount() {
    if (mounted) return; mounted = true;
    var root = U.$("#v-photo");
    D.ed = el("div", { class: "ed empty" });
    D.rail = el("nav", { class: "rail", "aria-label": "Photo tools" });
    D.cv = el("canvas", { "aria-label": "Edited photo" });
    D.cvO = el("canvas", { class: "over", "aria-hidden": "true" });
    D.mask = el("canvas", { class: "over", "aria-hidden": "true" });
    D.mask.style.pointerEvents = "none";
    D.divider = el("div", { class: "divider", hidden: true, role: "slider", "aria-label": "Before and after divider", tabindex: "0" });
    D.frame = el("div", { class: "frame" }, [D.cv, D.cvO, D.mask, D.divider]);
    D.drop = el("div", { class: "dropzone" }, [
      el("h3", { text: "Drop a photo here" }), el("p", { text: "JPEG, PNG or WebP" }),
      el("button", { class: "btn primary", text: "Choose a photo", onclick: function () { U.pickFile(U.$("#pickPhoto")).then(function (f) { openFile(f[0]); }); } })
    ]);
    D.wrap = el("div", { class: "canvaswrap" }, [D.drop, D.frame]);
    D.info = el("span", { text: "" });
    D.undo = el("button", { class: "btn icon", title: "Undo (Ctrl+Z)", "aria-label": "Undo", onclick: function () { restore(S.hi - 1); } }, [U.icon("undo")]);
    D.redo = el("button", { class: "btn icon", title: "Redo (Ctrl+Shift+Z)", "aria-label": "Redo", onclick: function () { restore(S.hi + 1); } }, [U.icon("redo")]);
    var cmp = el("button", { class: "btn", title: "Hold to see the original" }, [el("span", { text: "Hold to compare" })]);
    function hold(v) { return function (e) { if (e.type === "keydown" && e.key !== " " && e.key !== "Enter") return; if (e.type === "keydown") e.preventDefault(); S.holding = v; applyCompareView(); }; }
    ["pointerdown"].forEach(function (t) { cmp.addEventListener(t, hold(true)); });
    ["pointerup", "pointerleave", "pointercancel", "blur"].forEach(function (t) { cmp.addEventListener(t, hold(false)); });
    cmp.addEventListener("keydown", hold(true)); cmp.addEventListener("keyup", hold(false));
    var split = el("button", { class: "btn", "aria-pressed": "false", title: "Before and after split view", onclick: function () { S.split = !S.split; split.setAttribute("aria-pressed", S.split); applyCompareView(); } }, [U.icon("split"), el("span", { text: "Split" })]);
    var save = el("button", { class: "btn", title: "Save project to your account", onclick: saveProject }, [U.icon("save"), el("span", { text: "Save" })]);
    var exp = el("button", { class: "btn primary", onclick: function () { previewDialog(); } }, [U.icon("export"), el("span", { text: "Preview and download" })]);
    D.bar = el("div", { class: "stagebar" }, [
      el("button", { class: "btn ghost sm", text: "New photo", onclick: function () { U.pickFile(U.$("#pickPhoto")).then(function (f) { openFile(f[0]); }); } }),
      el("span", { class: "fname", id: "pname" }), D.undo, D.redo, cmp, split, save, exp
    ]);
    D.stage = el("div", { class: "stage" }, [D.bar, D.wrap, el("div", { class: "stagefoot" }, [D.info])]);
    D.insp = el("div", { class: "insp" });
    D.ed.appendChild(D.rail); D.ed.appendChild(D.stage); D.ed.appendChild(D.insp);
    root.appendChild(D.ed);

    ["dragover", "dragenter"].forEach(function (t) { D.wrap.addEventListener(t, function (e) { e.preventDefault(); D.drop.classList.add("drag"); }); });
    ["dragleave", "drop"].forEach(function (t) { D.wrap.addEventListener(t, function () { D.drop.classList.remove("drag"); }); });
    D.wrap.addEventListener("drop", function (e) { e.preventDefault(); var f = e.dataTransfer && e.dataTransfer.files[0]; if (f) openFile(f); });
    bindStagePointer(); bindDivider();
    document.addEventListener("keydown", function (e) {
      if (!S.base || U.$("#v-photo").hidden) return;
      var tag = (e.target.tagName || "").toLowerCase(); if (tag === "input" || tag === "textarea" || tag === "select") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); restore(e.shiftKey ? S.hi + 1 : S.hi - 1); }
    });
    L.onUser(function () { if (S.base) { buildRail(); buildInsp(); } });
  }
  function showEditor(on) { if (!D.ed) return; D.ed.classList.toggle("empty", !on); D.drop.hidden = on; D.frame.hidden = !on; U.$("#pname").textContent = S.name; D.bar.hidden = !on; }

  function buildRail() {
    U.clear(D.rail);
    TOOLS.forEach(function (t) {
      var b = el("button", { type: "button", "aria-pressed": S.tool === t.id ? "true" : "false", onclick: function () { setTool(t.id); } }, [U.icon(t.icon || t.id), el("span", { text: t.label })]);
      if (t.vip && !L.isVip()) b.appendChild(el("i", { class: "lockdot", title: "VIP tool, free with sign-in" }));
      D.rail.appendChild(b);
    });
  }
  function bakeTransform() {
    if (tfIsDefault()) return;
    var t = transformed(0, 1);
    S.base = t; S.tf = defTf(); invalidate(); pushHist();
    U.toast("Crop and rotation were applied to the image first.");
  }
  function setTool(id) {
    var def = TOOLS.filter(function (t) { return t.id === id; })[0];
    if (def && def.vip && !U.gate("vip", "Remove object and Cutout are VIP tools.")) return;
    if (id === "remove" || id === "cutout") bakeTransform();
    if (id !== "retouch") R.mode = null;
    S.tool = id; buildRail(); buildInsp(); schedule();
    D.mask.style.pointerEvents = id === "remove" ? "auto" : "none";
    D.frame.style.cursor = id === "remove" ? "crosshair" : (id === "cutout" ? "copy" : "");
    if (id !== "remove") D.mask.getContext("2d").clearRect(0, 0, D.mask.width, D.mask.height);
  }

  /* ---------- stage pointer handling (text drag, brush, cutout click, divider) ---------- */
  function toCanvas(e) {
    var r = D.cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * D.cv.width / r.width, y: (e.clientY - r.top) * D.cv.height / r.height, u: (e.clientX - r.left) / r.width, v: (e.clientY - r.top) / r.height };
  }
  function bindStagePointer() {
    var drag = null, last = null;
    D.frame.addEventListener("pointerdown", function (e) {
      if (!S.base || e.target === D.divider) return;
      var p = toCanvas(e);
      if (S.tool === "text") {
        for (var i = S.items.length - 1; i >= 0; i--) {
          var b = S.items[i]._b;
          if (b && p.x >= b.x - 8 && p.x <= b.x + b.w + 8 && p.y >= b.y - 8 && p.y <= b.y + b.h + 8) {
            S.sel = i; drag = { i: i, dx: p.u - S.items[i].x, dy: p.v - S.items[i].y, moved: false };
            D.frame.setPointerCapture(e.pointerId); buildInsp(); schedule(); return;
          }
        }
        S.sel = -1; buildInsp(); schedule();
      } else if (S.tool === "remove") {
        brush.down = true; last = p; D.mask.setPointerCapture && D.mask.setPointerCapture(e.pointerId); stroke(p, p);
      } else if (S.tool === "cutout") { doCutout(p); }
      else if (S.tool === "retouch" && R.mode) { try { D.frame.setPointerCapture(e.pointerId); } catch (x) {} beginBrush(p); }
    });
    D.frame.addEventListener("pointermove", function (e) {
      if (drag) { var p = toCanvas(e), it = S.items[drag.i]; it.x = Math.max(0, Math.min(1, p.u - drag.dx)); it.y = Math.max(0, Math.min(1, p.v - drag.dy)); drag.moved = true; schedule(); }
      else if (brush.down && S.tool === "remove") { var q = toCanvas(e); stroke(last, q); last = q; }
      else if (B) moveBrush(toCanvas(e));
    });
    function end() { if (drag && drag.moved) pushHist(); drag = null; brush.down = false; if (B) endBrush(); }
    D.frame.addEventListener("pointerup", end); D.frame.addEventListener("pointercancel", end);
  }
  function stroke(a, b, sz) {
    sz = sz || brush.size;
    var x = D.mask.getContext("2d"); x.strokeStyle = "rgba(255,90,120,.65)"; x.fillStyle = "rgba(255,90,120,.65)";
    x.lineWidth = sz; x.lineCap = "round"; x.lineJoin = "round";
    x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
    x.beginPath(); x.arc(b.x, b.y, sz / 2, 0, 7); x.fill();
  }
  function bindDivider() {
    var on = false;
    function mv(e) { if (!on) return; var r = D.cv.getBoundingClientRect(); S.splitAt = Math.max(0.02, Math.min(0.98, (e.clientX - r.left) / r.width)); applyCompareView(); }
    D.divider.addEventListener("pointerdown", function (e) { on = true; D.divider.setPointerCapture(e.pointerId); e.preventDefault(); });
    D.divider.addEventListener("pointermove", mv);
    D.divider.addEventListener("pointerup", function () { on = false; });
    D.divider.addEventListener("keydown", function (e) { if (e.key === "ArrowLeft") S.splitAt = Math.max(0.02, S.splitAt - 0.03); else if (e.key === "ArrowRight") S.splitAt = Math.min(0.98, S.splitAt + 0.03); else return; e.preventDefault(); applyCompareView(); });
  }

  /* ---------- inspector ---------- */
  function sl(key, label, min, max, tier, why) {
    var s = U.slider({ label: label, min: min, max: max, value: S.settings[key], tier: tier, why: why,
      onInput: function (v) { S.settings[key] = v; schedule(); }, onChange: function () { pushHist(); } });
    D.sliders[key] = s; return s.node;
  }
  function group(title, kids) { return el("div", { class: "group" }, [title ? el("h4", { text: title }) : null].concat(kids)); }
  function head(t) { return [el("h3", { text: t })]; }

  function buildInsp() {
    if (!D.insp) return;
    var top = D.insp.scrollTop; U.clear(D.insp); D.sliders = {};
    var p = PANELS[S.tool] ? PANELS[S.tool]() : [];
    p.forEach(function (n) { if (n) D.insp.appendChild(n); });
    D.insp.scrollTop = top;
  }
  /* Presets are looks now: they run on top of the current quality, with the same enhancement. */
  function applyPreset(name) {
    if (name === "Reset") return enhanceTo("orig");
    return enhanceTo(S.lvl === "orig" ? "ai" : S.lvl, name);
  }

  var PANELS = {
    enhance: function () {
      var chips = el("div", { class: "chips" });
      LEVELS.forEach(function (id) {
        var def = levelDef(id), od = outDims(levelScale(id)), tooBig = od[0] * od[1] > MAX_PX;
        var b = U.chip(def.label, S.lvl === id, function () { enhanceTo(id); }, def.tier === "vip" && !L.isVip() ? [U.vipBadge()] : []);
        b.title = id === "orig" ? "Your photo as it is" : id === "ai" ? "AI enhance at the current size" : od[0] + " × " + od[1] + " px"; if (tooBig) b.disabled = true; chips.appendChild(b);
      });
      var looks = el("div", { class: "chips" });
      LOOKS.forEach(function (n) {
        looks.appendChild(U.chip(n, S.look === n, function () { enhanceTo(S.lvl === "orig" ? "ai" : S.lvl, n); }, F.PRESET_TIERS[n] === "vip" && !L.isVip() ? [U.vipBadge()] : []));
      });
      var applied = AUTO_LABELS.filter(function (l) { return S.settings[l[0]] > 0; }).map(function (l) { return l[1] + " " + S.settings[l[0]]; });
      var cached = S.viewImg && S.viewKey === curKey(S.lvl);
      return head("Enhance").concat([
        el("p", { class: "hint", text: "Pick a look and a quality. Every look works with every quality. Lumio enhances the photo right away and keeps the detail clear and natural." }),
        group("Look", [looks]),
        group("Quality", [chips]),
        group("Set automatically", [el("p", { class: "hint", text: S.lvl === "orig" ? "Nothing is applied to the original." : (applied.length ? applied.join(" · ") : "This photo needed no fixes.") })]),
        S.status ? el("p", { class: "note", text: cached ? S.status : "You changed something after enhancing. Pick a quality again to refresh." }) : null,
        el("div", { class: "actions" }, [
          el("button", { class: "btn", text: "Preview quality", onclick: function () { previewDialog(); } }),
          el("button", { class: "btn primary", text: "Download", onclick: function () { previewDialog(); } })
        ]),
        group("Formulas", [el("div", { class: "actions", style: "margin-top:0" }, [
          el("button", { class: "btn sm", text: "Save these settings", onclick: saveFormula }),
          el("button", { class: "btn sm", text: "Use a code", onclick: useCode })
        ])])
      ]);
    },
    retouch: function () {
      var modes = [["teeth", "Whiten teeth"], ["lips", "Lips and blush"], ["hair", "Hair color"], ["push", "Reshape: push"], ["pinch", "Reshape: slim"], ["bloat", "Reshape: enlarge"]];
      var chips = el("div", { class: "chips" });
      modes.forEach(function (m) { chips.appendChild(U.chip(m[1], R.mode === m[0], function () { setBrush(R.mode === m[0] ? null : m[0]); }, L.isVip() ? [] : [U.vipBadge()])); });
      var nodes = head("Retouch").concat([el("p", { class: "hint", text: "Skin smoothing is set for you when you pick a quality in Enhance. Use the brushes for local touch-ups." }), group("Brushes", [chips])]);
      if (R.mode) {
        var colored = R.mode === "lips" || R.mode === "hair", sw = el("div", { class: "swatches" });
        if (colored) {
          (R.mode === "lips" ? LIPS : HAIRS).forEach(function (c) { var b = el("button", { type: "button", class: "swatch", "aria-label": "Color " + c, "aria-pressed": R.color === c ? "true" : "false", onclick: function () { R.color = c; buildInsp(); } }); b.style.background = c; sw.appendChild(b); });
          var pick = el("input", { type: "color", value: R.color, "aria-label": "Custom color" }); pick.addEventListener("input", function () { R.color = pick.value; });
          sw.appendChild(pick);
        }
        nodes.push(group(null, [
          U.slider({ label: "Brush size", min: 10, max: 160, value: R.size, reset: 40, onInput: function (v) { R.size = v; } }).node,
          U.slider({ label: R.mode === "push" || R.mode === "pinch" || R.mode === "bloat" ? "Strength" : "Amount", min: 5, max: 100, value: R.amt, reset: 60, onInput: function (v) { R.amt = v; } }).node,
          colored ? sw : null
        ]));
      }
      return nodes;
    },
    color: function () {
      return head("Light and color", "Shape the mood. Reset any slider with a double-click on its label.").concat([
        sl("bright", "Brightness", -50, 50), sl("shadows", "Shadows", -50, 50), sl("highlights", "Highlights", -50, 50),
        sl("sat", "Saturation", -50, 50), sl("warm", "Warmth", -50, 50), sl("vignette", "Vignette", 0, 100), sl("grain", "Film grain", 0, 100)
      ]);
    },
    filters: function () { return head("Filters", "Nine filters are free. The rest open with a sign-in.").concat([tileGrid(F.FILTERS, "filter", "fstr", F.tierOfFilter), sl("fstr", "Filter strength", 0, 100)]); },
    styles: function () { return head("Creative styles", "Turn the photo into art. Styles are VIP and free with a sign-in.").concat([tileGrid(F.STYLES, "style", "sstr", F.tierOfStyle), sl("sstr", "Style strength", 0, 100)]); },
    crop: function () {
      var rc = el("div", { class: "chips" });
      Object.keys(RATIOS).forEach(function (r) { rc.appendChild(U.chip(r === "orig" ? "Original" : r, S.tf.ratio === r, function () { S.tf.ratio = r; S.tf.px = 0; S.tf.py = 0; pushHist(); buildInsp(); schedule(); })); });
      function act(icon, label, fn) { return el("button", { class: "btn sm", onclick: function () { fn(); invalidate(); pushHist(); buildInsp(); schedule(); } }, [U.icon(icon), el("span", { text: label })]); }
      function tfSl(key, label, min, max) {
        return U.slider({ label: label, min: min, max: max, value: S.tf[key], onInput: function (v) { S.tf[key] = v; schedule(); }, onChange: function () { pushHist(); } }).node;
      }
      return head("Crop and rotate", "Pick a shape, then zoom and move the frame with the sliders.").concat([
        group("Shape", [rc]),
        group("Rotate and flip", [el("div", { class: "actions", style: "margin-top:0" }, [
          act("rotl", "Left", function () { S.tf.rot = (S.tf.rot + 270) % 360; }), act("rotr", "Right", function () { S.tf.rot = (S.tf.rot + 90) % 360; }),
          act("flip", "Mirror", function () { S.tf.fx = !S.tf.fx; }), act("flip", "Flip", function () { S.tf.fy = !S.tf.fy; })
        ])]),
        group("Frame", [tfSl("zoom", "Zoom", 0, 100), tfSl("px", "Move left or right", -100, 100), tfSl("py", "Move up or down", -100, 100)]),
        el("button", { class: "btn sm", text: "Reset crop", onclick: function () { S.tf = defTf(); invalidate(); pushHist(); buildInsp(); schedule(); } })
      ]);
    },
    text: function () {
      var em = el("div", { class: "emoji" });
      STICKERS.forEach(function (s) { em.appendChild(el("button", { type: "button", "aria-label": "Add sticker " + s, text: s, onclick: function () { addItem({ kind: "sticker", t: s, size: 0.14 }); } })); });
      var nodes = head("Text and stickers", "Add words or stickers, then drag them on the photo.").concat([
        el("button", { class: "btn primary", text: "Add text", onclick: function () { addItem({ kind: "text", t: "Your text", size: 0.09, bold: true, outline: true, font: "display" }); } }),
        group("Stickers", [em])
      ]);
      var it = S.items[S.sel];
      if (it) {
        var inp = el("input", { type: "text", maxlength: "80", value: it.t });
        inp.addEventListener("input", function () { it.t = inp.value || " "; schedule(); });
        inp.addEventListener("change", pushHist);
        var sw = el("div", { class: "swatches" });
        COLORS.forEach(function (c) { var b = el("button", { type: "button", class: "swatch", "aria-label": "Color " + c, "aria-pressed": it.color === c ? "true" : "false", onclick: function () { it.color = c; pushHist(); buildInsp(); schedule(); } }); b.style.background = c; sw.appendChild(b); });
        var fonts = el("div", { class: "chips" });
        Object.keys(FONTS).forEach(function (f) { fonts.appendChild(U.chip(f, (it.font || "sans") === f, function () { it.font = f; pushHist(); buildInsp(); schedule(); })); });
        nodes.push(group("Selected", [
          it.kind === "text" ? el("label", { class: "field" }, [el("span", { text: "Text" }), inp]) : null,
          U.slider({ label: "Size", min: 3, max: 40, value: Math.round(it.size * 100), onInput: function (v) { it.size = v / 100; schedule(); }, onChange: pushHist }).node,
          it.kind === "text" ? el("div", {}, [sw, el("div", { style: "height:10px" }), fonts, el("div", { class: "actions" }, [
            U.chip("Bold", !!it.bold, function () { it.bold = !it.bold; pushHist(); buildInsp(); schedule(); }),
            U.chip("Outline", !!it.outline, function () { it.outline = !it.outline; pushHist(); buildInsp(); schedule(); })
          ])]) : null,
          el("div", { class: "actions" }, [el("button", { class: "btn sm", onclick: function () { S.items.splice(S.sel, 1); S.sel = -1; pushHist(); buildInsp(); schedule(); } }, [U.icon("trash"), el("span", { text: "Delete" })])])
        ]));
      }
      return nodes;
    },
    remove: function () {
      var bs = U.slider({ label: "Brush size", min: 6, max: 100, value: brush.size, reset: 28, onInput: function (v) { brush.size = v; } });
      return head("Remove object", "Paint over what you want gone, then press Remove. It fills from the surrounding pixels, so it suits small objects on simple backgrounds.").concat([
        bs.node,
        el("div", { class: "actions" }, [
          el("button", { class: "btn primary", text: "Remove painted area", onclick: doRemove }),
          el("button", { class: "btn", text: "Clear brush", onclick: function () { D.mask.getContext("2d").clearRect(0, 0, D.mask.width, D.mask.height); } })
        ])
      ]);
    },
    cutout: function () {
      var ts = U.slider({ label: "Tolerance", min: 1, max: 100, value: tol, reset: 28, onInput: function (v) { tol = v; } });
      return head("Cutout", "Click the background to make it transparent. Export as PNG to keep the transparency.").concat([
        ts.node
      ]);
    }
  };

  function tileGrid(list, key, strKey, tierFn) {
    var g = el("div", { class: "fgrid" }), src = transformed(120);
    list.forEach(function (f) {
      var cv = mk(src.width, src.height), x = cv.getContext("2d"); x.drawImage(src, 0, 0);
      var o = {}; o[key] = f.id; o[strKey] = S.settings[strKey] || 70;
      if (f.id !== "none") { var id = x.getImageData(0, 0, cv.width, cv.height); E.enhance(id, cv.width, cv.height, o); x.putImageData(id, 0, 0); }
      var locked = tierFn(f.id) === "vip" && !L.isVip();
      var b = el("button", { type: "button", class: "ftile", "aria-pressed": S.settings[key] === f.id ? "true" : "false", onclick: function () {
        if (!U.gate(tierFn(f.id), f.label + " is a VIP " + (key === "filter" ? "filter." : "style."))) return;
        S.settings[key] = f.id; pushHist(); schedule();
        U.$$(".ftile", g).forEach(function (n) { n.setAttribute("aria-pressed", "false"); }); b.setAttribute("aria-pressed", "true");
      } }, [cv, el("span", { text: f.label })]);
      if (locked) b.appendChild(U.vipBadge());
      g.appendChild(b);
    });
    return g;
  }
  function addItem(o) {
    S.items.push(Object.assign({ x: 0.5, y: 0.5, color: "#ffffff" }, o)); S.sel = S.items.length - 1; pushHist(); buildInsp(); schedule();
  }

  /* ---------- retouch brushes ---------- */
  var LIPS = ["#d6336c", "#c2185b", "#e8505b", "#ff8fab", "#9d174d", "#b91c1c"];
  var HAIRS = ["#1b1b1b", "#4a2c1a", "#8b5a2b", "#e6c27a", "#b83232", "#7c4dff", "#2f80ed", "#e91e63"];
  var AMT = { teeth: 70, lips: 55, hair: 80, push: 60, pinch: 50, bloat: 50 };
  function hexRgb(h) { var n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function cloneBase() { var c = mk(S.base.width, S.base.height); c.getContext("2d").drawImage(S.base, 0, 0); S.base = c; S.rotC = null; }
  function setBrush(mode) {
    if (mode && !U.gate("vip", "Retouch brushes are VIP tools.")) return;
    if (mode) bakeTransform();
    R.mode = mode; if (mode) { R.amt = AMT[mode]; if (mode === "lips") R.color = LIPS[0]; if (mode === "hair") R.color = HAIRS[1]; }
    D.mask.getContext("2d").clearRect(0, 0, D.mask.width, D.mask.height);
    D.frame.style.cursor = mode ? "crosshair" : ""; buildInsp();
  }
  function isWarp() { return R.mode === "push" || R.mode === "pinch" || R.mode === "bloat"; }
  function dab(p, dx, dy) {
    var f = B.f, r = R.size / 2 * f, cx = p.x * f, cy = p.y * f, pad = Math.ceil(r * 1.7 + 4), bw = S.base.width, bh = S.base.height;
    var x0 = Math.max(0, Math.floor(cx - pad)), y0 = Math.max(0, Math.floor(cy - pad)), x1 = Math.min(bw, Math.ceil(cx + pad)), y1 = Math.min(bh, Math.ceil(cy + pad));
    var ctx = S.base.getContext("2d"), id = ctx.getImageData(x0, y0, x1 - x0, y1 - y0), k = R.mode === "push" ? R.amt / 100 : R.amt / 100 * 0.3;
    E.liquify(id.data, id.width, id.height, cx - x0, cy - y0, r, R.mode, dx * f, dy * f, k);
    ctx.putImageData(id, x0, y0); schedule();
  }
  function beginBrush(p) {
    B = { last: p, minx: p.x, maxx: p.x, miny: p.y, maxy: p.y, f: S.base.width / D.cv.width };
    if (isWarp()) { cloneBase(); dab(p, 0, 0); } else stroke(p, p, R.size);
  }
  function moveBrush(q) {
    var dx = q.x - B.last.x, dy = q.y - B.last.y, dist = Math.sqrt(dx * dx + dy * dy);
    if (isWarp()) {
      if (R.mode === "push") { if (dist < 1.5) return; dab(q, dx, dy); B.last = q; }
      else if (dist >= R.size * 0.08) { dab(q, 0, 0); B.last = q; }
      return;
    }
    stroke(B.last, q, R.size); B.last = q;
    B.minx = Math.min(B.minx, q.x); B.maxx = Math.max(B.maxx, q.x); B.miny = Math.min(B.miny, q.y); B.maxy = Math.max(B.maxy, q.y);
  }
  function endBrush() {
    var b = B; B = null;
    if (isWarp()) { pushHist(); return; }
    var f = b.f, pad = R.size / 2 + 3, mc = D.mask;
    var sx0 = Math.max(0, Math.floor(b.minx - pad)), sy0 = Math.max(0, Math.floor(b.miny - pad)), sx1 = Math.min(mc.width, Math.ceil(b.maxx + pad)), sy1 = Math.min(mc.height, Math.ceil(b.maxy + pad));
    var bx0 = Math.floor(sx0 * f), by0 = Math.floor(sy0 * f), bw = Math.max(1, Math.min(S.base.width - bx0, Math.ceil((sx1 - sx0) * f))), bh = Math.max(1, Math.min(S.base.height - by0, Math.ceil((sy1 - sy0) * f)));
    var m = mk(bw, bh), mx = m.getContext("2d"); mx.drawImage(mc, sx0, sy0, sx1 - sx0, sy1 - sy0, 0, 0, bw, bh);
    var md = mx.getImageData(0, 0, bw, bh).data, raw = new Uint8Array(bw * bh), i;
    for (i = 0; i < raw.length; i++) raw[i] = md[i * 4 + 3] > 20 ? 1 : 0;
    var soft = E.softMask(raw, bw, bh, Math.max(1, Math.round(R.size * f * 0.1)));
    cloneBase();
    var ctx = S.base.getContext("2d"), id = ctx.getImageData(bx0, by0, bw, bh);
    if (R.mode === "teeth") E.whitenMasked(id.data, bw, bh, soft, R.amt); else E.recolorMasked(id.data, bw, bh, soft, hexRgb(R.color), R.amt);
    ctx.putImageData(id, bx0, by0);
    mc.getContext("2d").clearRect(0, 0, mc.width, mc.height); pushHist(); schedule();
  }

  /* ---------- destructive tools ---------- */
  function doRemove() {
    var mc = D.mask, mx = mc.getContext("2d"), md = mx.getImageData(0, 0, mc.width, mc.height).data, any = false;
    for (var i = 3; i < md.length; i += 4) if (md[i] > 20) { any = true; break; }
    if (!any) { U.toast("Paint over the object first, then press Remove.", "err"); return; }
    var bw = S.base.width, bh = S.base.height, full = mk(bw, bh), fx = full.getContext("2d");
    fx.drawImage(mc, 0, 0, bw, bh);
    var fd = fx.getImageData(0, 0, bw, bh).data, x0 = bw, y0 = bh, x1 = 0, y1 = 0, x, y;
    for (y = 0; y < bh; y++) for (x = 0; x < bw; x++) if (fd[(y * bw + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    var pad = 40; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(bw - 1, x1 + pad); y1 = Math.min(bh - 1, y1 + pad);
    var w = x1 - x0 + 1, h = y1 - y0 + 1, mask = new Uint8Array(w * h);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (fd[((y + y0) * bw + (x + x0)) * 4 + 3] > 20) mask[y * w + x] = 1;
    for (var pass = 0; pass < 2; pass++) { // grow the mask so edges are covered
      var grown = mask.slice();
      for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) if (!mask[y * w + x] && (mask[y * w + x - 1] || mask[y * w + x + 1] || mask[(y - 1) * w + x] || mask[(y + 1) * w + x])) grown[y * w + x] = 1;
      mask = grown;
    }
    var nb = mk(bw, bh), nx = nb.getContext("2d"); nx.drawImage(S.base, 0, 0);
    var sub = nx.getImageData(x0, y0, w, h);
    E.inpaintRegion(sub, w, h, mask);
    nx.putImageData(sub, x0, y0);
    S.base = nb; invalidate(); mx.clearRect(0, 0, mc.width, mc.height); pushHist(); schedule(); U.toast("Removed.");
  }
  function doCutout(p) {
    var bw = S.base.width, bh = S.base.height, x = Math.max(0, Math.min(bw - 1, Math.floor(p.u * bw))), y = Math.max(0, Math.min(bh - 1, Math.floor(p.v * bh)));
    var nb = mk(bw, bh), nx = nb.getContext("2d"); nx.drawImage(S.base, 0, 0);
    var id = nx.getImageData(0, 0, bw, bh), vis = E.floodFill(id.data, bw, bh, x, y, tol), n = 0;
    for (var i = 0; i < vis.length; i++) n += vis[i];
    if (!n) { U.toast("Nothing selected there. Click a spot on the background.", "err"); return; }
    if (n > bw * bh * 0.97) { U.toast("That selection covers almost the whole photo. Click the background, or lower the tolerance.", "err"); return; }
    E.applyCutout(id.data, bw, bh, vis); nx.putImageData(id, 0, 0);
    S.base = nb; S.alpha = true; invalidate(); pushHist(); schedule(); U.toast("Background removed. Export as PNG to keep it.");
  }

  /* ---------- formulas ---------- */
  function saveFormula() {
    if (!U.gate("vip", "Saving formulas is a VIP feature.")) return;
    U.ask("Save formula", "Formula name", S.name + " look").then(function (name) {
      if (!name) return;
      L.api.createFormula(name, S.settings).then(function (f) {
        U.modal(el("div", {}, [el("h2", { text: "Formula saved" }), el("p", { class: "lede", text: "Share this code. Anyone can apply it without an account." }), el("p", {}, [el("span", { class: "code", text: f.code })]),
          el("div", { class: "actions" }, [el("button", { class: "btn primary", text: "Copy code", onclick: function () { if (navigator.clipboard) navigator.clipboard.writeText(f.code).then(function () { U.toast("Code copied."); }, function () { U.toast("Copy failed. Select the code and copy it.", "err"); }); } })])]));
      }).catch(U.fail);
    });
  }
  function useCode() {
    U.ask("Use a formula code", "Code (8 letters and digits)", "", "Apply").then(function (code) {
      if (!code) return;
      L.api.publicFormula(code).then(function (f) {
        var s = E.sanitize(f.settings);
        if (F.settingsNeedVip(s) && !U.gate("vip", "This formula uses VIP filters or styles.")) return;
        S.settings = s; pushHist(); buildInsp(); schedule(); U.toast("Applied “" + f.name + "”" + (f.author ? " by " + f.author : "") + ".");
      }).catch(U.fail);
    });
  }

  /* ---------- preview and download ---------- */
  function finalBlob(e, fmt, q) {
    if (fmt === "png" && !S.items.length) return Promise.resolve(e.blob);
    return U.loadImage(e.blob).then(function (im) {
      var c = mk(im.naturalWidth, im.naturalHeight), x = c.getContext("2d");
      if (fmt === "jpeg") { x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); }
      x.drawImage(im, 0, 0); drawItems(x, c.width, c.height, false);
      return U.canvasBlob(c, fmt === "png" ? "image/png" : (fmt === "webp" ? "image/webp" : "image/jpeg"), q / 100);
    });
  }
  /* Side by side: the plain enlargement (before) and the enhanced result (after). Fit shows the whole photo; click it, or press 100%, to inspect real pixels, and drag to move. */
  function previewDialog(startId) {
    if (!S.base) return;
    var cur = startId || (S.lvl !== "orig" ? S.lvl : "hd"), fmt = S.alpha ? "png" : "jpeg", q = 92, entry = null, img = null, mode = "fit", ctr = { x: 0.5, y: 0.35 }, m;
    var PW = 420, PH = 440, tabs = el("div", { class: "chips" }), looksBox = el("div", { class: "chips" }), info = el("p", { class: "hint" }), err = el("p", { class: "err", role: "alert" });
    function pane(label) { var c = el("canvas", { class: "pv", width: PW, height: PH, "aria-label": label }); return { c: c, node: el("figure", { class: "pvbox" }, [c, el("figcaption", { text: label })]) }; }
    var pb = pane("Before (plain enlargement)"), pa = pane("After (enhanced)"), body = el("div"), controls = el("div");
    function draw() {
      if (!entry || !img) return;
      var w = entry.w, h = entry.h, cr = cropRect(), src = rotCanvas(), k = w / cr.cw, panes = [pb.c, pa.c];
      panes.forEach(function (c) { var x = c.getContext("2d"); x.fillStyle = "#0f0d16"; x.fillRect(0, 0, PW, PH); x.imageSmoothingQuality = "high"; });
      var bx = pb.c.getContext("2d"), ax = pa.c.getContext("2d");
      if (mode === "fit") {
        var sc = Math.min(PW / w, PH / h), dw = w * sc, dh = h * sc, ox = (PW - dw) / 2, oy = (PH - dh) / 2;
        bx.drawImage(src, cr.sx, cr.sy, cr.cw, cr.ch, ox, oy, dw, dh); ax.drawImage(img, 0, 0, w, h, ox, oy, dw, dh);
      } else {
        var vw = Math.min(PW, w), vh = Math.min(PH, h), vx = clamp(ctr.x * w - vw / 2, 0, w - vw), vy = clamp(ctr.y * h - vh / 2, 0, h - vh);
        ctr.x = (vx + vw / 2) / w; ctr.y = (vy + vh / 2) / h;
        bx.drawImage(src, cr.sx + vx / k, cr.sy + vy / k, vw / k, vh / k, 0, 0, vw, vh); ax.drawImage(img, vx, vy, vw, vh, 0, 0, vw, vh);
      }
    }
    function show(id) {
      cur = id; err.textContent = ""; U.clear(tabs);
      LEVELS.forEach(function (l) { var d = levelDef(l); tabs.appendChild(U.chip(d.label, cur === l, function () { load(l); }, d.tier === "vip" && !L.isVip() ? [U.vipBadge()] : [])); });
      U.clear(looksBox);
      LOOKS.forEach(function (n) { looksBox.appendChild(U.chip(n, S.look === n, function () { load(cur === "orig" ? "ai" : cur, n); }, F.PRESET_TIERS[n] === "vip" && !L.isVip() ? [U.vipBadge()] : [])); });
      controls.textContent = ""; controls.appendChild(modeBar());
      info.textContent = entry ? entry.w + " × " + entry.h + " px (" + (entry.w * entry.h / 1e6).toFixed(1) + " MP). " + (NEURAL_TEXT[entry.neural] || "") + "." : "";
    }
    function modeBar() {
      return el("div", { class: "chips" }, [
        U.chip("Fit", mode === "fit", function () { mode = "fit"; show(cur); draw(); }),
        U.chip("100% (real pixels)", mode === "100", function () { mode = "100"; show(cur); draw(); })
      ]);
    }
    function load(id, look) {
      return enhanceTo(id, look).then(function (e) {
        if (!e) return; entry = e; return U.loadImage(e.blob).then(function (im) { img = im; show(id); draw(); });
      });
    }
    [pb, pa].forEach(function (p) {
      var drag = null;
      p.c.addEventListener("pointerdown", function (e) {
        if (!entry) return; var r = p.c.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
        if (mode === "fit") {
          var sc = Math.min(PW / entry.w, PH / entry.h), ox = (PW - entry.w * sc) / 2, oy = (PH - entry.h * sc) / 2;
          ctr = { x: clamp((fx * PW - ox) / (entry.w * sc), 0, 1), y: clamp((fy * PH - oy) / (entry.h * sc), 0, 1) }; mode = "100"; show(cur); draw();
        }
        drag = { x: e.clientX, y: e.clientY }; p.c.setPointerCapture(e.pointerId);
      });
      p.c.addEventListener("pointermove", function (e) {
        if (!drag || mode !== "100" || !entry) return; var r = p.c.getBoundingClientRect(), k = PW / r.width;
        ctr.x -= (e.clientX - drag.x) * k / entry.w; ctr.y -= (e.clientY - drag.y) * k / entry.h; drag = { x: e.clientX, y: e.clientY }; draw();
      });
      ["pointerup", "pointercancel"].forEach(function (t) { p.c.addEventListener(t, function () { drag = null; }); });
    });
    var fm = el("div", { class: "chips" }), qs = el("div");
    function drawFmt() {
      U.clear(fm); U.clear(qs);
      [["png", "PNG"], ["jpeg", "JPEG"], ["webp", "WebP"]].forEach(function (f) { fm.appendChild(U.chip(f[1], fmt === f[0], function () { fmt = f[0]; drawFmt(); })); });
      if (fmt !== "png") qs.appendChild(U.slider({ label: "Quality", min: 50, max: 100, value: q, reset: 92, onInput: function (v) { q = v; } }).node);
    }
    drawFmt();
    var go = el("button", { class: "btn primary", text: "Download this quality", onclick: function () {
      if (!entry) return; err.textContent = "";
      var f = S.alpha && fmt !== "png" ? "png" : fmt, b = U.busy("Preparing your download…");
      finalBlob(entry, f, q).then(function (blob) {
        U.download(blob, S.name + "-lumio-" + (cur === "orig" ? "original" : cur + "-" + S.look.toLowerCase().replace(/[^a-z]+/g, "-")) + "." + (f === "jpeg" ? "jpg" : f));
        b.done(); U.toast("Downloaded " + entry.w + " × " + entry.h + " (" + U.bytes(blob.size) + ").");
      }).catch(function (e) { b.done(); err.textContent = U.errMsg(e); });
    } });
    body.appendChild(looksBox); body.appendChild(tabs); body.appendChild(controls);
    body.appendChild(el("div", { class: "pvrow" }, [pb.node, pa.node]));
    body.appendChild(info);
    body.appendChild(el("div", { class: "group" }, [el("h4", { text: "Format" }), fm, qs]));
    if (S.alpha) body.appendChild(el("p", { class: "note", text: "This photo has a transparent background. JPEG cannot keep it, so Lumio will download PNG." }));
    m = U.modal(el("div", {}, [el("h2", { text: "Preview and download" }), el("p", { class: "lede", text: "Pick a look and a quality to see them before you download. Each combination is enhanced when you pick it." }), body, err,
      el("div", { class: "actions" }, [go, el("button", { class: "btn ghost", text: "Close", onclick: function () { m.close(); } })])]), { wide: true });
    var card = m.card || (U.$(".modal .card")); if (card) card.style.width = "min(960px,100%)";
    show(cur); load(cur);
  }

  /* ---------- cloud projects ---------- */
  function saveProject() {
    if (!U.gate("vip", "Saving projects to your account is a VIP feature.")) return;
    U.ask("Save project", "Project name", S.name).then(function (name) {
      if (!name) return;
      var b = U.busy("Saving…"), thumbC = mk(240, Math.round(240 * D.cv.height / D.cv.width)); thumbC.getContext("2d").drawImage(D.cv, 0, 0, thumbC.width, thumbC.height);
      var thumb = thumbC.toDataURL("image/jpeg", 0.7), mime = S.alpha ? "image/png" : "image/jpeg";
      var make = S.projectId ? L.api.updateProject(S.projectId, { name: name, settings: S.settings, thumb: thumb }) : L.api.createProject({ name: name, mode: "photo", settings: S.settings, thumb: thumb });
      make.then(function (p) {
        S.projectId = p.id;
        return U.canvasBlob(S.base, mime, 0.92).then(function (blob) {
          return blob.size > 24 * 1048576 ? U.canvasBlob(S.base, "image/jpeg", 0.8) : blob;
        }).then(function (blob) { return L.api.putProjectImage(p.id, blob); });
      }).then(function () { b.done(); U.toast("Saved to your projects."); }).catch(function (e) { b.done(); U.fail(e); });
    });
  }

  /* ---------- public ---------- */
  window.Photo = {
    mount: mount,
    open: openFile,
    openBlob: function (blob, name, settings, projectId) { return U.loadImage(blob).then(function (im) { openImage(im, name, { settings: settings, projectId: projectId }); }); },
    openImage: openImage,
    hasImage: function () { return !!S.base; },
    settings: function () { return copy(S.settings); },
    applySettings: function (s) { if (!S.base) return false; S.settings = E.sanitize(s); pushHist(); buildInsp(); schedule(); return true; },
    applyPreset: applyPreset, aiEnhance: aiEnhance,
    setTool: function (id) { mount(); if (S.base) setTool(id); },
    show: function () { mount(); if (S.base) { buildRail(); buildInsp(); schedule(); } else showEditor(false); },
    base: function () { return S.base; },
    name: function () { return S.name; },
    transformedFull: function () { return transformed(0, 1); },
    neutral: neutral
  };
})();

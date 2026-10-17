/* Video editor: live enhanced preview, trim, speed, mirror, captions, soundtrack, WAV extraction, recorded export. */
(function () {
  "use strict";
  var U = window.UI, L = window.Lumio, E = window.LumioEngine, F = window.LumioFeatures, el = U.el;

  var V = { vid: null, url: null, name: "video", settings: E.sanitize({}), speed: 1, a: 0, b: 0, dur: 0, mirror: false, capText: "", caps: [],
    audio: null, audioName: "", audioSrc: null, origVol: 100, musVol: 80, stab: false, stabStr: 85, blend: 0, prevC: null, dirty: true, ac: null, resId: "720", sliders: {}, file: null };
  var D = {}, mounted = false, PREVIEW = 640;

  function resDef() { return F.resById(F.VIDEO_RESOLUTIONS, V.resId); }
  function serverOk() { return L.mode === "server" && L.health && L.health.ffmpeg; }
  function mk(w, h) { var c = document.createElement("canvas"); c.width = Math.max(2, w); c.height = Math.max(2, h); return c; }
  function clampSettings(s) { var o = E.sanitize(s); o.tilt = 0; o.style = "none"; return o; }
  function fmt(t) { return E.fmt(t || 0); }

  /* ---------- stabilizer: block matching on a tiny gray frame, smoothed camera path ---------- */
  var ST = { prev: null, px: 0, py: 0, sx: 0, sy: 0, cx: 0, cy: 0, lastT: -1, c: null };
  function stabReset() { ST.prev = null; ST.px = ST.py = ST.sx = ST.sy = ST.cx = ST.cy = 0; ST.lastT = -1; V.prevC = null; }
  function stabEstimate() {
    var t = V.vid.currentTime; if (t === ST.lastT) return;
    if (ST.lastT < 0 || t < ST.lastT || t - ST.lastT > 0.5) ST.prev = null;
    ST.lastT = t;
    var c = ST.c || (ST.c = mk(80, 45)), x = c.getContext("2d"), g = new Uint8Array(80 * 45), i;
    try { x.drawImage(V.vid, 0, 0, 80, 45); } catch (e) { return; }
    var d = x.getImageData(0, 0, 80, 45).data;
    for (i = 0; i < g.length; i++) g[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
    if (ST.prev) {
      var m = E.estimateShift(ST.prev, g, 80, 45, 5, 8), bx = m.dx, by = m.dy;
      ST.px += -bx; ST.py += -by;
      var a = V.stabStr / 100; ST.sx = a * ST.sx + (1 - a) * ST.px; ST.sy = a * ST.sy + (1 - a) * ST.py;
      ST.cx = Math.max(-3.6, Math.min(3.6, ST.sx - ST.px)); ST.cy = Math.max(-2, Math.min(2, ST.sy - ST.py));
    }
    ST.prev = g;
  }

  /* ---------- frame rendering (shared by preview and export) ---------- */
  function renderFrame(ctx, w, h) {
    var vid = V.vid;
    if (V.stab && !vid.paused) stabEstimate();
    var z = V.stab ? 1.1 : 1;
    ctx.save();
    ctx.translate(w / 2 + (V.stab ? ST.cx * w / 80 : 0), h / 2 + (V.stab ? ST.cy * h / 45 : 0));
    ctx.scale((V.mirror ? -1 : 1) * z, z);
    try { ctx.drawImage(vid, -w / 2, -h / 2, w, h); } catch (e) { /* frame not ready */ }
    ctx.restore();
    if (!window.Photo.neutral(V.settings)) { var id = ctx.getImageData(0, 0, w, h); E.enhance(id, w, h, V.settings); ctx.putImageData(id, 0, 0); }
    if (V.blend > 0 && !vid.paused) {
      if (V.prevC && V.prevC.width === w && V.prevC.height === h) { ctx.globalAlpha = V.blend / 100 * 0.8; ctx.drawImage(V.prevC, 0, 0); ctx.globalAlpha = 1; }
      else V.prevC = mk(w, h);
      V.prevC.getContext("2d").drawImage(ctx.canvas, 0, 0);
    }
    var t = vid.currentTime, i;
    for (i = 0; i < V.caps.length; i++) {
      var c = V.caps[i];
      if (t >= c.a && t <= c.b) {
        var px = Math.round(h * 0.06);
        ctx.save(); ctx.font = "700 " + px + "px 'Figtree','Segoe UI',system-ui,sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        ctx.lineJoin = "round"; ctx.lineWidth = Math.max(2, px * 0.14); ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.fillStyle = "#fff";
        ctx.strokeText(c.t, w / 2, h - px * 0.7, w * 0.92); ctx.fillText(c.t, w / 2, h - px * 0.7, w * 0.92); ctx.restore();
        break;
      }
    }
  }
  function previewSize() {
    var vw = V.vid.videoWidth || 640, vh = V.vid.videoHeight || 360, s = Math.min(1, PREVIEW / Math.max(vw, vh));
    return [Math.round(vw * s), Math.round(vh * s)];
  }
  function tick() {
    requestAnimationFrame(tick);
    var root = U.$("#v-video");
    if (!mounted || root.hidden || !V.vid || !V.vid.videoWidth || V.exporting) return;
    if (!V.vid.paused && V.vid.currentTime >= V.b - 0.03) { V.vid.pause(); V.vid.currentTime = V.a; syncAudio(true); setPlayIcon(); }
    if (!V.dirty && V.vid.paused) { return; }
    var s = previewSize(), cv = D.cv;
    if (cv.width !== s[0] || cv.height !== s[1]) { cv.width = s[0]; cv.height = s[1]; }
    renderFrame(cv.getContext("2d"), s[0], s[1]);
    V.dirty = false;
    D.seek.value = Math.round(V.vid.currentTime * 1000); D.time.textContent = fmt(V.vid.currentTime) + " / " + fmt(V.dur);
  }

  /* ---------- audio helpers ---------- */
  function syncAudio(pauseToo) {
    if (!V.audio) return;
    var t = Math.max(0, V.vid.currentTime - V.a);
    try { if (V.audio.duration && t < V.audio.duration) V.audio.currentTime = t; } catch (e) {}
    if (pauseToo) V.audio.pause();
  }
  function setVolumes() { if (V.vid) V.vid.volume = V.ac && V.vGain ? 1 : V.origVol / 100; if (V.vGain) V.vGain.gain.value = V.origVol / 100; if (V.audio) { V.audio.volume = V.ac ? 1 : V.musVol / 100; if (V.mGain) V.mGain.gain.value = V.musVol / 100; } }
  function setPlayIcon() { if (!D.play) return; U.clear(D.play); D.play.appendChild(U.icon(V.vid && !V.vid.paused ? "pause" : "play")); D.play.setAttribute("aria-label", V.vid && !V.vid.paused ? "Pause" : "Play"); }

  /* ---------- mount ---------- */
  function mount() {
    if (mounted) return; mounted = true;
    var root = U.$("#v-video");
    V.vid = el("video", { playsinline: true, preload: "auto" }); V.vid.style.display = "none"; V.vid.crossOrigin = "anonymous";
    D.cv = el("canvas", { "aria-label": "Video preview" });
    D.frame = el("div", { class: "frame" }, [D.cv]);
    D.drop = el("div", { class: "dropzone" }, [
      el("h3", { text: "Drop a video here" }), el("p", { text: "MP4, WebM or MOV" }),
      el("button", { class: "btn primary", text: "Choose a video", onclick: pick })
    ]);
    D.wrap = el("div", { class: "canvaswrap" }, [D.drop, D.frame]);
    D.play = el("button", { class: "btn icon", "aria-label": "Play", onclick: togglePlay }, [U.icon("play")]);
    D.seek = el("input", { type: "range", min: "0", max: "1000", value: "0", "aria-label": "Seek" });
    D.time = el("span", { text: "0:00 / 0:00" });
    D.seek.addEventListener("input", function () { V.vid.currentTime = Number(D.seek.value) / 1000; syncAudio(false); V.dirty = true; });
    D.bar = el("div", { class: "vbar" }, [D.play, D.seek, D.time]);
    D.stage = el("div", { class: "stage" }, [
      el("div", { class: "stagebar" }, [el("button", { class: "btn ghost sm", text: "New video", onclick: pick }), el("span", { class: "fname", id: "vname" })]),
      D.wrap, D.bar,
      el("div", { class: "stagefoot" }, [el("span", { id: "vinfo" })])
    ]);
    D.insp = el("div", { class: "insp" });
    D.root = el("div", { class: "split" }, [D.stage, D.insp]);
    root.appendChild(D.root); root.appendChild(V.vid);
    ["dragover", "dragenter"].forEach(function (t) { D.wrap.addEventListener(t, function (e) { e.preventDefault(); D.drop.classList.add("drag"); }); });
    ["dragleave", "drop"].forEach(function (t) { D.wrap.addEventListener(t, function () { D.drop.classList.remove("drag"); }); });
    D.wrap.addEventListener("drop", function (e) { e.preventDefault(); var f = e.dataTransfer && e.dataTransfer.files[0]; if (f) open(f); });
    V.vid.addEventListener("seeked", function () { V.dirty = true; if (V.vid.paused) stabReset(); });
    V.vid.addEventListener("loadeddata", function () { V.dirty = true; });
    V.vid.addEventListener("play", function () { setPlayIcon(); });
    V.vid.addEventListener("pause", function () { setPlayIcon(); });
    V.vid.addEventListener("error", function () { if (V.url) U.toast("This browser cannot play that video. Try an MP4 (H.264) or WebM file.", "err"); });
    L.onUser(function () { if (V.dur) buildInsp(); });
    showEmpty(true); buildInsp(); requestAnimationFrame(tick);
  }
  function showEmpty(on) { D.drop.hidden = !on; D.frame.hidden = on; D.bar.hidden = on; U.$$(".stagebar", D.stage)[0].hidden = on; D.root.classList.toggle("empty", on); }
  function pick() { U.pickFile(U.$("#pickVideo")).then(function (f) { open(f[0]); }); }

  function open(file) {
    if (!file) return;
    if (!/^video\//.test(file.type) && !/\.(mp4|mov|webm|m4v|mkv)$/i.test(file.name)) { U.toast("Choose a video file (MP4, WebM or MOV).", "err"); return; }
    mount();
    if (V.url) URL.revokeObjectURL(V.url);
    V.file = file; V.url = URL.createObjectURL(file); V.name = file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "video";
    V.vid.onloadedmetadata = function () {
      V.dur = V.vid.duration || 0; V.a = 0; V.b = V.dur; V.speed = 1; V.vid.playbackRate = 1;
      D.seek.max = String(Math.round(V.dur * 1000)); U.$("#vname").textContent = file.name;
      U.$("#vinfo").textContent = V.vid.videoWidth + " × " + V.vid.videoHeight + " · " + fmt(V.dur) + " · " + U.bytes(file.size);
      V.dirty = true; showEmpty(false); buildInsp(); setPlayIcon();
    };
    V.vid.src = V.url; V.vid.load();
  }
  function togglePlay() {
    var v = V.vid; if (!v.videoWidth) return;
    if (v.paused) {
      if (v.currentTime < V.a || v.currentTime >= V.b - 0.05) { v.currentTime = V.a; syncAudio(false); }
      v.playbackRate = V.speed; if (V.ac && V.ac.state === "suspended") V.ac.resume();
      v.play().catch(function () { U.toast("The browser blocked playback. Press play again.", "err"); });
      if (V.audio) { syncAudio(false); V.audio.play().catch(function () {}); }
    } else { v.pause(); if (V.audio) V.audio.pause(); }
  }

  /* ---------- inspector ---------- */
  function sl(key, label, min, max, tier) {
    var s = U.slider({ label: label, min: min, max: max, value: V.settings[key], tier: tier,
      onInput: function (v) { V.settings[key] = v; V.dirty = true; } });
    V.sliders[key] = s; return s.node;
  }
  function group(title, kids) { return el("div", { class: "group" }, [el("h4", { text: title })].concat(kids)); }
  function buildInsp() {
    var top = D.insp.scrollTop; U.clear(D.insp); V.sliders = {};
    if (!V.dur) {
      D.insp.appendChild(el("h3", { text: "Video" })); D.insp.appendChild(el("p", { class: "hint", text: "Open a video to get started." }));
      return;
    }
    var presets = el("div", { class: "chips" });
    Object.keys(E.PRESETS).forEach(function (n) {
      presets.appendChild(U.chip(n, false, function () {
        if (F.PRESET_TIERS[n] === "vip" && !U.gate("vip", n + " is a VIP preset.")) return;
        V.settings = clampSettings(E.PRESETS[n]); V.dirty = true; buildInsp();
      }, F.PRESET_TIERS[n] === "vip" && !L.isVip() ? [U.vipBadge()] : []));
    });
    var filters = el("div", { class: "chips" });
    F.FILTERS.forEach(function (f) {
      filters.appendChild(U.chip(f.label, V.settings.filter === f.id, function () {
        if (!U.gate(F.tierOfFilter(f.id), f.label + " is a VIP filter.")) return;
        V.settings.filter = f.id; V.dirty = true; buildInsp();
      }, f.tier === "vip" && !L.isVip() ? [U.vipBadge()] : []));
    });
    var speed = U.slider({ label: "Speed", min: 0.25, max: 4, step: 0.25, value: V.speed, reset: 1, onInput: function (v) { V.speed = v; V.vid.playbackRate = v; } });
    var ta = U.slider({ label: "Start (seconds)", min: 0, max: Math.max(1, Math.floor(V.dur * 10) / 10), step: 0.1, value: Math.round(V.a * 10) / 10, reset: 0, onInput: function (v) { V.a = Math.min(v, V.b - 0.2); V.vid.currentTime = V.a; syncAudio(false); V.dirty = true; } });
    var tb = U.slider({ label: "End (seconds)", min: 0, max: Math.max(1, Math.floor(V.dur * 10) / 10), step: 0.1, value: Math.round(V.b * 10) / 10, reset: V.dur, onInput: function (v) { V.b = Math.max(v, V.a + 0.2); } });
    var caps = el("textarea", { placeholder: "0:01-0:03 First caption\n0:04-0:07 Second caption", "aria-label": "Captions" }); caps.value = V.capText;
    caps.addEventListener("input", function () { V.capText = caps.value; V.caps = E.parseCaps(caps.value); V.dirty = true; capNote.textContent = V.caps.length + " caption" + (V.caps.length === 1 ? "" : "s") + " ready."; });
    var script = el("textarea", { placeholder: "Paste your script. One sentence or line per caption.", "aria-label": "Script", style: "min-height:70px;margin-top:8px", class: "scr" });
    function spread() {
      if (!script.value.trim()) { U.toast("Paste a script first.", "err"); return; }
      V.caps = E.scriptToCaps(script.value, V.a, V.b); V.capText = E.capsToText(V.caps); caps.value = V.capText; V.dirty = true; capNote.textContent = V.caps.length + " captions ready.";
    }
    var capNote = el("p", { class: "hint", text: V.caps.length + " captions ready." });
    var resChips = el("div", { class: "chips" });
    F.VIDEO_RESOLUTIONS.forEach(function (r) {
      if (r.server && !serverOk()) return;
      resChips.appendChild(U.chip(r.label, V.resId === r.id, function () { if (!U.gate(r.tier, r.label + " export is a VIP option.")) return; V.resId = r.id; buildInsp(); }, r.tier === "vip" && !L.isVip() ? [U.vipBadge()] : []));
    });
    if (serverOk() && L.health.ai) resChips.appendChild(U.chip("AI enhance (slow)", V.ai !== false, function () { if (!U.gate("vip", "AI video enhance is a VIP feature.")) return; V.ai = V.ai === false; buildInsp(); }, L.isVip() ? [] : [U.vipBadge()]));
    if (serverOk()) resChips.appendChild(U.chip("Render on server", V.useServer, function () { if (!U.gate("vip", "Server render is a VIP feature.")) return; V.useServer = !V.useServer; buildInsp(); }, L.isVip() ? [] : [U.vipBadge()]));
    var music = el("div", {}, [
      el("div", { class: "actions", style: "margin-top:0" }, [
        el("button", { class: "btn sm", onclick: addMusic }, [U.icon("music"), el("span", { text: V.audio ? "Change soundtrack" : "Add soundtrack" })]),
        V.audio ? el("button", { class: "btn sm ghost", text: "Remove", onclick: removeMusic }) : null
      ]),
      V.audio ? el("p", { class: "hint", style: "margin-top:6px", text: V.audioName }) : null,
      U.slider({ label: "Original audio", min: 0, max: 100, value: V.origVol, reset: 100, onInput: function (v) { V.origVol = v; setVolumes(); } }).node,
      V.audio ? U.slider({ label: "Soundtrack volume", min: 0, max: 100, value: V.musVol, reset: 80, onInput: function (v) { V.musVol = v; setVolumes(); } }).node : null
    ]);
    var nodes = [
      el("h3", { text: "Video" }),
      el("button", { class: "btn primary", text: "AI enhance", onclick: aiEnhanceVideo }),
      group("Presets", [presets]),
      group("Fix", [sl("denoise", "Noise reduction", 0, 100), sl("sharpen", "Sharpen", 0, 100), sl("clarity", "Clarity", 0, 100), sl("dehaze", "Dehaze", 0, 100), sl("autowb", "Auto color balance", 0, 100), sl("contrast", "Auto contrast", 0, 100)]),
      group("Retouch", [sl("skin", "Skin smoothing", 0, 100), sl("glow", "Soft glow", 0, 100)]),
      group("Light and color", [sl("bright", "Brightness", -50, 50), sl("shadows", "Shadows", -50, 50), sl("highlights", "Highlights", -50, 50), sl("sat", "Saturation", -50, 50), sl("warm", "Warmth", -50, 50), sl("vignette", "Vignette", 0, 100), sl("grain", "Film grain", 0, 100)]),
      group("Filter", [filters, el("div", { style: "height:10px" }), sl("fstr", "Filter strength", 0, 100)]),
      group("Speed and trim", [speed.node, ta.node, tb.node, U.chip("Mirror", V.mirror, function () { V.mirror = !V.mirror; V.dirty = true; buildInsp(); })]),
      group("Steady and smooth", [
        U.chip("Stabilize", V.stab, function () { if (!U.gate("vip", "Stabilization is a VIP tool.")) return; V.stab = !V.stab; stabReset(); V.dirty = true; buildInsp(); }, L.isVip() ? [] : [U.vipBadge()]),
        V.stab ? U.slider({ label: "Steadiness", min: 50, max: 95, value: V.stabStr, reset: 85, onInput: function (v) { V.stabStr = v; } }).node : null,
        U.slider({ label: "Frame blending", min: 0, max: 100, value: V.blend, reset: 0, tier: "vip", why: "Frame blending is a VIP tool.", onInput: function (v) { V.blend = v; V.prevC = null; V.dirty = true; } }).node
      ]),
      group("Captions", [caps, capNote, script, el("div", { class: "actions", style: "margin-top:6px" }, [el("button", { class: "btn sm", text: "Time the script across the clip", onclick: spread })])]),
      group("Soundtrack", [music]),
      group("Audio", [el("button", { class: "btn sm", text: "Extract audio as WAV", onclick: extractAudio })]),
      group("Export", [resChips,
        el("div", { class: "actions" }, [el("button", { class: "btn primary", text: "Export video", onclick: exportVideo })])])
    ];
    nodes.forEach(function (n) { D.insp.appendChild(n); }); D.insp.scrollTop = top;
  }

  /* Analyse the current frame and set the fix and light sliders from it. */
  function aiEnhanceVideo() {
    var vw = V.vid.videoWidth, vh = V.vid.videoHeight;
    if (!vw) { U.toast("Wait for the video to load first.", "err"); return; }
    var c = mk(320, Math.max(2, Math.round(320 * vh / vw))), x = c.getContext("2d");
    x.drawImage(V.vid, 0, 0, c.width, c.height);
    var r = E.aiEnhance(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
    V.settings = clampSettings(Object.assign({}, r.settings, { filter: V.settings.filter, fstr: V.settings.fstr }));
    V.dirty = true; buildInsp();
    U.toast(r.notes.length ? "AI enhance fixed: " + r.notes.join(", ") + "." : "AI enhance: this clip already looks good. Small tweaks applied.");
  }
  function addMusic() {
    var inp = document.createElement("input"); inp.type = "file"; inp.accept = "audio/*";
    inp.addEventListener("change", function () {
      var f = inp.files[0]; if (!f) return;
      removeMusic(true);
      V.audio = new Audio(URL.createObjectURL(f)); V.audio.preload = "auto"; V.audio.loop = false; V.audioName = f.name; setVolumes(); buildInsp();
    });
    inp.click();
  }
  function removeMusic(silent) { if (V.audio) { V.audio.pause(); V.audio = null; V.audioSrc = null; V.mGain = null; V.audioName = ""; } if (silent !== true) buildInsp(); }

  /* ---------- extract audio ---------- */
  function wavBlob(buf, from, to) {
    var ch = buf.numberOfChannels, sr = buf.sampleRate, s0 = Math.floor(from * sr), s1 = Math.min(buf.length, Math.floor(to * sr)), n = Math.max(0, s1 - s0);
    var out = new DataView(new ArrayBuffer(44 + n * ch * 2)), o = 0, i, c;
    function str(s) { for (var k = 0; k < s.length; k++) out.setUint8(o++, s.charCodeAt(k)); }
    str("RIFF"); out.setUint32(o, 36 + n * ch * 2, true); o += 4; str("WAVEfmt "); out.setUint32(o, 16, true); o += 4; out.setUint16(o, 1, true); o += 2;
    out.setUint16(o, ch, true); o += 2; out.setUint32(o, sr, true); o += 4; out.setUint32(o, sr * ch * 2, true); o += 4; out.setUint16(o, ch * 2, true); o += 2; out.setUint16(o, 16, true); o += 2;
    str("data"); out.setUint32(o, n * ch * 2, true); o += 4;
    var chans = []; for (c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
    for (i = 0; i < n; i++) for (c = 0; c < ch; c++) { var v = Math.max(-1, Math.min(1, chans[c][s0 + i])); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
    return new Blob([out.buffer], { type: "audio/wav" });
  }
  function extractAudio() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { U.toast("This browser cannot decode audio.", "err"); return; }
    if (V.file.size > 400 * 1048576) { U.toast("That video is too large to decode in the browser. Trim it first.", "err"); return; }
    var b = U.busy("Reading the audio…");
    V.file.arrayBuffer().then(function (ab) {
      var ctx = new AC();
      return new Promise(function (ok, bad) { var r = ctx.decodeAudioData(ab, ok, bad); if (r && r.then) r.then(ok, bad); }).then(function (buf) { ctx.close && ctx.close(); return buf; });
    }).then(function (buf) {
      var blob = wavBlob(buf, V.a, V.b); U.download(blob, V.name + "-audio.wav"); b.done(); U.toast("Audio saved (" + U.bytes(blob.size) + ").");
    }).catch(function () { b.done(); U.toast("No readable audio track was found in this video.", "err"); });
  }

  /* ---------- export ---------- */
  function ensureAudioGraph() {
    var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    if (!V.ac) { V.ac = new AC(); V.vSrc = V.ac.createMediaElementSource(V.vid); V.vGain = V.ac.createGain(); V.vSrc.connect(V.vGain); V.vGain.connect(V.ac.destination); }
    if (V.audio && !V.audioSrc) { V.audioSrc = V.ac.createMediaElementSource(V.audio); V.mGain = V.ac.createGain(); V.audioSrc.connect(V.mGain); V.mGain.connect(V.ac.destination); }
    setVolumes(); return V.ac;
  }
  function exportVideo() {
    var rd = resDef();
    if (!U.gate(rd.tier, rd.label + " export is a VIP option.")) return;
    var aiOn = serverOk() && L.health.ai && V.ai !== false && L.isVip();
    if (rd.server || V.useServer || aiOn) { serverExport(rd, aiOn); return; }
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) { U.toast("This browser cannot record video. Use a current Chrome, Edge or Firefox.", "err"); return; }
    var vw = V.vid.videoWidth, vh = V.vid.videoHeight, k = rd.short / Math.min(vw, vh);
    var ow = Math.round(vw * k / 2) * 2, oh = Math.round(vh * k / 2) * 2, out = mk(ow, oh), ox = out.getContext("2d");
    V.vid.pause(); V.vid.currentTime = V.a; stabReset();
    var probe = performance.now(); renderFrame(ox, ow, oh); var cost = performance.now() - probe;
    var warn = cost > 60 ? "Your effects take about " + Math.round(cost) + " ms per frame at " + ow + " × " + oh + ", so the export may skip frames. Lower the resolution or the Noise reduction, Glow and Clarity sliders for smoother results. Continue?" : null;
    (warn ? U.confirm("Heavy settings", warn, "Export anyway") : Promise.resolve(true)).then(function (go) { if (go) runExport(out, ow, oh); });
  }
  function serverExport(rd, ai) {
    if (!V.file) return;
    var b = U.busy("Rendering " + rd.label + " on the server" + (ai ? " with AI enhance" : "") + ". This can take several minutes.");
    L.api.renderVideo(V.file, V.settings, { target: rd.short, speed: V.speed, mirror: V.mirror, start: Math.round(V.a * 100) / 100, end: Math.round(V.b * 100) / 100, ai: ai }).then(function (r) {
      U.download(r.blob, V.name + "-lumio-" + rd.label.toLowerCase() + ".mp4"); b.done();
      U.toast("Exported " + r.width + " × " + r.height + " (" + U.bytes(r.blob.size) + ")." + (r.skipped ? " Not applied on the server: " + r.skipped + "." : "") + (ai && r.neural !== "ai" ? " AI enhance was skipped (" + ({ "too-long": "clip too long for this server's AI limit", "not-needed": "no upscaling needed", unavailable: "AI worker is off" }[r.neural] || "not possible") + "), so the standard render was used." : ""));
    }).catch(function (e) { b.done(); U.fail(e); });
  }
  function runExport(out, ow, oh) {
    var ox = out.getContext("2d"), stream = out.captureStream(30), ac = ensureAudioGraph(), dest = null, cancelled = false;
    if (ac) { dest = ac.createMediaStreamDestination(); V.vGain.connect(dest); if (V.mGain) V.mGain.connect(dest); dest.stream.getAudioTracks().forEach(function (t) { stream.addTrack(t); }); if (ac.state === "suspended") ac.resume(); }
    var types = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"], mime = "", i;
    for (i = 0; i < types.length; i++) if (MediaRecorder.isTypeSupported(types[i])) { mime = types[i]; break; }
    var rec; try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: resDef().short >= 2160 ? 25e6 : (resDef().short >= 1440 ? 14e6 : (resDef().short >= 1080 ? 10e6 : 6e6)) } : {}); } catch (e) { U.toast("Recording could not start in this browser.", "err"); return; }
    var chunks = []; rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    var b = U.busy("Exporting " + ow + " × " + oh + "…", true);
    var cancel = el("button", { class: "btn sm", style: "margin-top:12px", text: "Cancel", onclick: function () { cancelled = true; finish(); } });
    U.$(".busy > div").appendChild(cancel);
    var finished = false;
    function finish() {
      if (finished) return; finished = true;
      V.vid.pause(); if (V.audio) V.audio.pause();
      try { if (rec.state !== "inactive") rec.stop(); } catch (e) {}
      if (dest) { try { V.vGain.disconnect(dest); if (V.mGain) V.mGain.disconnect(dest); } catch (e) {} }
    }
    rec.onstop = function () {
      b.done(); V.exportingDone && V.exportingDone();
      if (cancelled) { U.toast("Export cancelled."); } else {
        var blob = new Blob(chunks, { type: (rec.mimeType || mime || "video/webm").split(";")[0] });
        if (!blob.size) { U.toast("The export produced no data. Try a lower resolution.", "err"); }
        else { U.download(blob, V.name + "-lumio-" + resDef().label.toLowerCase() + "." + (/mp4/.test(blob.type) ? "mp4" : "webm")); U.toast("Exported (" + U.bytes(blob.size) + ")."); }
      }
      V.exporting = false; V.vid.currentTime = V.a; V.dirty = true;
    };
    V.exporting = true;
    function onSeeked() {
      V.vid.removeEventListener("seeked", onSeeked);
      V.vid.playbackRate = V.speed; syncAudio(false);
      rec.start(500); V.vid.play(); if (V.audio) V.audio.play().catch(function () {});
      (function loop() {
        if (finished) return;
        renderFrame(ox, ow, oh);
        var t = V.vid.currentTime, span = Math.max(0.1, V.b - V.a);
        b.progress((t - V.a) / span);
        if (t >= V.b - 0.03 || V.vid.ended) { finish(); return; }
        requestAnimationFrame(loop);
      })();
    }
    V.vid.addEventListener("seeked", onSeeked);
    if (Math.abs(V.vid.currentTime - V.a) < 0.001) { V.vid.currentTime = V.a + 0.001; } else { V.vid.currentTime = V.a; }
  }

  window.Video = {
    mount: mount, open: open,
    show: function () { mount(); V.dirty = true; },
    hasVideo: function () { return !!V.dur; },
    settings: function () { return JSON.parse(JSON.stringify(V.settings)); },
    pause: function () { if (V.vid && !V.vid.paused) { V.vid.pause(); if (V.audio) V.audio.pause(); } }
  };
})();

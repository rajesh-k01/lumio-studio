/* App shell: router, home hub with a live before/after hero, start-up. */
(function () {
  "use strict";
  var U = window.UI, L = window.Lumio, E = window.LumioEngine, F = window.LumioFeatures, el = U.el;
  var VIEWS = ["home", "photo", "video", "collage", "batch", "formulas", "projects", "plans"];
  var current = "home";

  /* ---------- generated test scene (no stock photos) ---------- */
  function mk(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function scene(w, h) {
    var c = mk(w, h), x = c.getContext("2d"), g = x.createLinearGradient(0, 0, 0, h * 0.7);
    g.addColorStop(0, "#27356b"); g.addColorStop(0.45, "#b45f86"); g.addColorStop(0.8, "#f9a66a"); g.addColorStop(1, "#ffdc9a");
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    var sun = x.createRadialGradient(w * 0.68, h * 0.55, 0, w * 0.68, h * 0.55, h * 0.22);
    sun.addColorStop(0, "#fff6d8"); sun.addColorStop(0.35, "rgba(255,214,150,.9)"); sun.addColorStop(1, "rgba(255,170,110,0)");
    x.fillStyle = sun; x.fillRect(0, 0, w, h);
    x.fillStyle = "rgba(255,255,255,.22)";
    [[0.18, 0.2, 0.2, 0.035], [0.34, 0.3, 0.16, 0.025], [0.82, 0.18, 0.16, 0.03]].forEach(function (p) { x.beginPath(); x.ellipse(w * p[0], h * p[1], w * p[2], h * p[3], 0, 0, 7); x.fill(); });
    function hill(y, amp, col, ph) {
      x.fillStyle = col; x.beginPath(); x.moveTo(0, h);
      for (var i = 0; i <= 40; i++) { var t = i / 40; x.lineTo(t * w, h * y + Math.sin(t * 5 + ph) * h * amp + Math.sin(t * 13 + ph * 2) * h * amp * 0.25); }
      x.lineTo(w, h); x.closePath(); x.fill();
    }
    hill(0.62, 0.05, "#5a4a7c", 0.5); hill(0.72, 0.06, "#3b3566", 2); hill(0.84, 0.05, "#1f2447", 4);
    x.fillStyle = "#12152e";
    [0.12, 0.2, 0.3, 0.86, 0.94].forEach(function (p, i) { var th = h * (0.16 + (i % 3) * 0.04), bx = w * p, by = h * 0.9; x.beginPath(); x.moveTo(bx, by - th); x.lineTo(bx + th * 0.28, by); x.lineTo(bx - th * 0.28, by); x.fill(); });
    var cx = w * 0.56, cy = h * 0.8; x.fillRect(cx, cy, w * 0.1, h * 0.09); x.beginPath(); x.moveTo(cx - w * 0.01, cy); x.lineTo(cx + w * 0.05, cy - h * 0.07); x.lineTo(cx + w * 0.11, cy); x.fill();
    x.fillStyle = "#ffd27a"; x.fillRect(cx + w * 0.035, cy + h * 0.03, w * 0.03, h * 0.04);
    return c;
  }
  function degrade(c) {
    var w = c.width, h = c.height, x = c.getContext("2d"), small = mk(Math.round(w * 0.6), Math.round(h * 0.6)), sx = small.getContext("2d");
    sx.drawImage(c, 0, 0, small.width, small.height); x.imageSmoothingQuality = "low"; x.drawImage(small, 0, 0, w, h);
    var id = x.getImageData(0, 0, w, h), d = id.data, seed = 7, i;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; }
    for (i = 0; i < d.length; i += 4) {
      var l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2], n = rnd() * 46;
      d[i] = (l + (d[i] - l) * 0.55) * 0.74 + 8 + n; d[i + 1] = (l + (d[i + 1] - l) * 0.55) * 0.74 + 14 + n; d[i + 2] = (l + (d[i + 2] - l) * 0.55) * 0.78 + 30 + n;
    }
    x.putImageData(id, 0, 0); return c;
  }
  function enhanced(c, params) {
    var o = mk(c.width, c.height), x = o.getContext("2d"); x.drawImage(c, 0, 0);
    var id = x.getImageData(0, 0, o.width, o.height); E.enhance(id, o.width, o.height, E.sanitize(params)); x.putImageData(id, 0, 0); return o;
  }

  /* ---------- starting work from the home hub ---------- */
  function withPhoto(fn) {
    if (window.Photo.hasImage()) { location.hash = "#/photo"; fn(); return; }
    U.pickFile(U.$("#pickPhoto")).then(function (fs) {
      if (!fs[0]) return;
      window.Photo.open(fs[0]).then(function () { location.hash = "#/photo"; fn(); });
    });
  }
  function openVideo() { U.pickFile(U.$("#pickVideo")).then(function (fs) { if (fs[0]) { window.Video.open(fs[0]); location.hash = "#/video"; } }); }

  var TOOL_TILES = [
    { t: "Enhance photo", d: "Fix noise, softness and color in one tap", i: "enhance", tier: "free", go: function () { withPhoto(function () { window.Photo.setTool("enhance"); }); } },
    { t: "Enhance video", d: "Clean up a clip and export it", i: "video", tier: "free", go: openVideo },
    { t: "Portrait retouch", d: "Smooth skin, add glow, blur the background", i: "retouch", tier: "free", go: function () { withPhoto(function () { window.Photo.setTool("retouch"); }); } },
    { t: "Face and body reshape", d: "Slim, enlarge and push with a brush", i: "retouch", tier: "vip", go: function () { withPhoto(function () { window.Photo.setTool("retouch"); }); } },
    { t: "Makeup and teeth", d: "Lip color, blush, whiter teeth, new hair color", i: "color", tier: "vip", go: function () { withPhoto(function () { window.Photo.setTool("retouch"); }); } },
    { t: "Light and color", d: "Brightness, shadows, warmth and more", i: "color", tier: "free", go: function () { withPhoto(function () { window.Photo.setTool("color"); }); } },
    { t: "Filters", d: "Nine free looks, eight more with sign-in", i: "filters", tier: "free", go: function () { withPhoto(function () { window.Photo.setTool("filters"); }); } },
    { t: "Creative styles", d: "Cartoon, sketch and mosaic", i: "styles", tier: "vip", go: function () { withPhoto(function () { window.Photo.setTool("styles"); }); } },
    { t: "Crop and rotate", d: "Common shapes, zoom, mirror and flip", i: "crop", tier: "free", go: function () { withPhoto(function () { window.Photo.setTool("crop"); }); } },
    { t: "Text and stickers", d: "Drag words and stickers onto a photo", i: "text", tier: "free", go: function () { withPhoto(function () { window.Photo.setTool("text"); }); } },
    { t: "Remove object", d: "Paint over small things to erase them", i: "remove", tier: "vip", go: function () { withPhoto(function () { window.Photo.setTool("remove"); }); } },
    { t: "Cutout", d: "Make a plain background transparent", i: "cutout", tier: "vip", go: function () { withPhoto(function () { window.Photo.setTool("cutout"); }); } },
    { t: "Collage", d: "Eight layouts, gaps and rounded corners", i: "collage", tier: "free", go: function () { location.hash = "#/collage"; } },
    { t: "Batch enhance", d: "Apply one look to up to 30 photos", i: "batch", tier: "vip", go: function () { location.hash = "#/batch"; } },
    { t: "Formulas", d: "Save a look and share it with a code", i: "formulas", tier: "free", go: function () { location.hash = "#/formulas"; } },
    { t: "Projects", d: "Save photos to your account", i: "projects", tier: "vip", go: function () { location.hash = "#/projects"; } }
  ];

  function buildHome() {
    var root = U.$("#v-home"); U.clear(root);
    var W = 640, H = 400, bad = degrade(scene(W, H)), good = enhanced(bad, E.PRESETS["Auto fix"] && { denoise: 60, sharpen: 62, contrast: 72, clarity: 28, autowb: 85, sat: 16, dehaze: 28, shadows: 12 });
    var before = el("canvas", { class: "before", width: W, height: H, "aria-label": "Before: a dim, noisy test scene" }), after = el("canvas", { class: "after", width: W, height: H, "aria-label": "After: the same scene enhanced" });
    before.getContext("2d").drawImage(bad, 0, 0); after.getContext("2d").drawImage(good, 0, 0);
    var handle = el("div", { class: "handle" }), rng = el("input", { type: "range", min: "0", max: "100", value: "50", "aria-label": "Drag to compare before and after" });
    function setPos(v) { after.style.clipPath = "inset(0 0 0 " + v + "%)"; handle.style.left = v + "%"; rng.value = v; }
    var cmp = el("div", { class: "cmp" }, [before, after, handle, el("span", { class: "tag l", text: "Before" }), el("span", { class: "tag r", text: "After" }), rng]);
    rng.addEventListener("input", function () { setPos(Number(rng.value)); });
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) setPos(50); else {
      var t0 = null; setPos(100);
      (function sweep(ts) { if (t0 === null) t0 = ts; var p = Math.min(1, (ts - t0) / 1400), e = 1 - Math.pow(1 - p, 3); setPos(100 - e * 50); if (p < 1) requestAnimationFrame(sweep); })(performance.now());
    }
    var hero = el("div", { class: "hero" }, [
      el("div", {}, [
        el("h1", { text: "Sharper photos and cleaner video, with no paywall" }),
        el("p", { text: "Every free tool works with no watermark and no limits. Sign in once and VIP opens up too, at no cost." }),
        el("div", { class: "cta" }, [
          el("button", { class: "btn primary", text: "Open a photo", onclick: function () { withPhoto(function () {}); } }),
          el("button", { class: "btn", text: "Open a video", onclick: openVideo }),
          L.isVip() ? null : el("button", { class: "btn vip", text: "Get VIP free", onclick: function () { U.authDialog({ tab: "up" }); } })
        ]),
      ]),
      cmp
    ]);
    var quick = el("div", { class: "quick" });
    (function () {
      var cv = el("canvas", { width: 300, height: 192, "aria-hidden": "true" }), s = degrade(scene(300, 192)), sx = s.getContext("2d");
      var r = E.aiEnhance(sx.getImageData(0, 0, 300, 192).data, 300, 192);
      cv.getContext("2d").drawImage(enhanced(s, r.settings), 0, 0);
      quick.appendChild(el("button", { class: "qtile", onclick: function () { withPhoto(function () { window.Photo.aiEnhance(); }); } }, [cv, el("span", { text: "AI enhance" })]));
    })();
    Object.keys(E.PRESETS).filter(function (n) { return n !== "Reset"; }).forEach(function (n) {
      var cv = el("canvas", { width: 300, height: 192, "aria-hidden": "true" }), s = degrade(scene(300, 192)), o = enhanced(s, E.PRESETS[n]);
      cv.getContext("2d").drawImage(o, 0, 0);
      var tier = F.PRESET_TIERS[n] === "vip", b = el("button", { class: "qtile", onclick: function () {
        if (tier && !U.gate("vip", n + " is a VIP preset.")) return;
        withPhoto(function () { window.Photo.applyPreset(n); });
      } }, [cv, el("span", { text: n })]);
      if (tier && !L.isVip()) b.appendChild(U.vipBadge());
      quick.appendChild(b);
    });
    var tiles = el("div", { class: "tools" });
    TOOL_TILES.forEach(function (t) {
      var b = el("button", { class: "tool", onclick: function () { if (t.tier === "vip" && !U.gate("vip", t.t + " is a VIP tool.")) return; t.go(); } }, [
        el("span", { class: "ic" }, [U.icon(t.i)]), el("span", {}, [el("b", { text: t.t }), el("small", { text: t.d })])
      ]);
      if (t.tier === "vip" && !L.isVip()) b.lastChild.firstChild.appendChild(document.createTextNode(" ")), b.lastChild.firstChild.appendChild(U.vipBadge());
      tiles.appendChild(b);
    });
    root.appendChild(hero);
    root.appendChild(el("div", { class: "section" }, [el("h2", { text: "Start with a look" }), quick]));
    root.appendChild(el("div", { class: "section" }, [el("h2", { text: "Everything Lumio can do" }), tiles]));
  }

  /* ---------- router ---------- */
  function route() {
    var name = (location.hash.replace(/^#\/?/, "") || "home").split("/")[0];
    if (VIEWS.indexOf(name) < 0) name = "home";
    if (current === "video" && name !== "video") window.Video.pause();
    current = name;
    VIEWS.forEach(function (v) { U.$("#v-" + v).hidden = v !== name; });
    U.$$("#nav a").forEach(function (a) { if (a.getAttribute("data-view") === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    document.title = (name === "home" ? "Lumio Studio" : (name.charAt(0).toUpperCase() + name.slice(1)) + " · Lumio Studio");
    draw(name);
    window.scrollTo(0, 0);
  }
  function draw(name) {
    if (name === "home") { buildHome(); }
    else if (name === "photo") window.Photo.show();
    else if (name === "video") window.Video.show();
    else if (name === "collage") window.Tools.collage();
    else if (name === "batch") window.Tools.batch();
    else if (name === "formulas") window.Tools.formulas();
    else if (name === "projects") window.Tools.projects();
    else if (name === "plans") window.Tools.plans();
  }

  window.addEventListener("hashchange", route);
  L.onUser(function () {
    U.renderAuth();
    if (current === "home") buildHome(); else if (["batch", "formulas", "projects", "plans"].indexOf(current) >= 0) draw(current);
  });
  L.init().then(function () {
    U.renderAuth();
    window.Photo.mount(); window.Video.mount();
    route();
  }).catch(function (e) { console.error(e); U.toast("Lumio could not start: " + U.errMsg(e), "err"); });
})();

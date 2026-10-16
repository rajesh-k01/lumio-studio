/* Collage, batch, formulas, projects and the Free-vs-VIP page. */
(function () {
  "use strict";
  var U = window.UI, L = window.Lumio, E = window.LumioEngine, F = window.LumioFeatures, el = U.el;
  function mk(w, h) { var c = document.createElement("canvas"); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; }
  function gateCard(root, title, text) {
    U.clear(root);
    root.appendChild(el("div", { class: "gate" }, [
      el("h2", { text: title }), el("p", { text: text }),
      el("div", { class: "actions", style: "justify-content:center" }, [
        el("button", { class: "btn vip", text: "Sign in for free VIP", onclick: function () { U.authDialog({ tab: "up" }); } }),
        el("button", { class: "btn", text: "I have an account", onclick: function () { U.authDialog({ tab: "in" }); } })
      ])
    ]));
  }

  /* ================= collage ================= */
  var LAYOUTS = {
    "2 across": [[0, 0, .5, 1], [.5, 0, .5, 1]],
    "2 stacked": [[0, 0, 1, .5], [0, .5, 1, .5]],
    "3 columns": [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]],
    "1 + 2 right": [[0, 0, .5, 1], [.5, 0, .5, .5], [.5, .5, .5, .5]],
    "1 + 2 below": [[0, 0, 1, .5], [0, .5, .5, .5], [.5, .5, .5, .5]],
    "Grid of 4": [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]],
    "1 + 4": [[0, 0, 1, .6], [0, .6, .25, .4], [.25, .6, .25, .4], [.5, .6, .25, .4], [.75, .6, .25, .4]],
    "Grid of 6": [[0, 0, 1 / 3, .5], [1 / 3, 0, 1 / 3, .5], [2 / 3, 0, 1 / 3, .5], [0, .5, 1 / 3, .5], [1 / 3, .5, 1 / 3, .5], [2 / 3, .5, 1 / 3, .5]]
  };
  var CO = { imgs: [], layout: "Grid of 4", ratio: "1:1", gap: 12, round: 0, bg: "#15121d" };
  var CR = { "1:1": [1080, 1080], "4:5": [1080, 1350], "9:16": [1080, 1920], "16:9": [1920, 1080] };
  var BGS = ["#15121d", "#ffffff", "#f1edf8", "#ffc15a", "#9d8cff", "#6fe0c5", "#ff8a98"];

  function collageDraw(cv) {
    var d = CR[CO.ratio], W = d[0], H = d[1];
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    var x = cv.getContext("2d"); x.fillStyle = CO.bg; x.fillRect(0, 0, W, H);
    LAYOUTS[CO.layout].forEach(function (r, i) {
      var cx = r[0] * W + CO.gap / 2, cy = r[1] * H + CO.gap / 2, cw = r[2] * W - CO.gap, ch = r[3] * H - CO.gap;
      if (r[0] === 0) { cx = CO.gap; cw = r[2] * W - CO.gap * 1.5; }
      x.save(); x.beginPath();
      if (x.roundRect) x.roundRect(cx, cy, cw, ch, CO.round); else x.rect(cx, cy, cw, ch);
      x.clip();
      var im = CO.imgs[i];
      if (im) {
        var s = Math.max(cw / im.width, ch / im.height), sw = cw / s, sh = ch / s;
        x.drawImage(im.cv, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, cx, cy, cw, ch);
      } else { x.fillStyle = "rgba(255,255,255,.08)"; x.fillRect(cx, cy, cw, ch); x.fillStyle = "rgba(255,255,255,.35)"; x.font = "600 " + Math.round(Math.min(cw, ch) * 0.12) + "px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("Photo " + (i + 1), cx + cw / 2, cy + ch / 2); }
      x.restore();
    });
  }
  function drawCollage() {
    var root = U.$("#v-collage"); U.clear(root);
    var cv = el("canvas", { "aria-label": "Collage preview" });
    cv.style.cssText = "max-width:100%;max-height:calc(100vh - 150px);box-shadow:0 10px 40px rgba(0,0,0,.5)";
    function redraw() { collageDraw(cv); }
    var lay = el("div", { class: "layouts" });
    Object.keys(LAYOUTS).forEach(function (n) {
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 40 40"); svg.setAttribute("aria-hidden", "true");
      LAYOUTS[n].forEach(function (r) { var rc = document.createElementNS("http://www.w3.org/2000/svg", "rect"); rc.setAttribute("x", r[0] * 40 + 1); rc.setAttribute("y", r[1] * 40 + 1); rc.setAttribute("width", r[2] * 40 - 2); rc.setAttribute("height", r[3] * 40 - 2); rc.setAttribute("rx", 2); svg.appendChild(rc); });
      lay.appendChild(el("button", { type: "button", title: n, "aria-label": n, "aria-pressed": CO.layout === n ? "true" : "false", onclick: function () { CO.layout = n; drawCollage(); } }, [svg]));
    });
    var ratios = el("div", { class: "chips" });
    Object.keys(CR).forEach(function (r) { ratios.appendChild(U.chip(r, CO.ratio === r, function () { CO.ratio = r; drawCollage(); })); });
    var sw = el("div", { class: "swatches" });
    BGS.forEach(function (c) { var b = el("button", { type: "button", class: "swatch", "aria-label": "Background " + c, "aria-pressed": CO.bg === c ? "true" : "false", onclick: function () { CO.bg = c; drawCollage(); } }); b.style.background = c; sw.appendChild(b); });
    var need = LAYOUTS[CO.layout].length;
    var list = el("div", { class: "list" });
    CO.imgs.forEach(function (im, i) {
      list.appendChild(el("div", { class: "it" }, [el("span", { class: "nm", text: (i + 1) + ". " + im.name }), el("button", { class: "btn sm ghost", text: "Remove", onclick: function () { CO.imgs.splice(i, 1); drawCollage(); } })]));
    });
    var insp = el("div", { class: "insp" }, [
      el("h3", { text: "Collage" }),
      el("button", { class: "btn primary", text: "Add photos", onclick: function () {
        U.pickFile(U.$("#pickPhoto"), true).then(function (files) {
          return Promise.all(files.slice(0, 12).map(function (f) { return U.loadImage(f).then(function (im) {
            var s = Math.min(1, 2000 / Math.max(im.naturalWidth, im.naturalHeight)), c = mk(Math.round(im.naturalWidth * s), Math.round(im.naturalHeight * s)); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
            return { cv: c, width: c.width, height: c.height, name: f.name };
          }).catch(function () { U.toast(f.name + " could not be opened.", "err"); return null; }); }));
        }).then(function (arr) { arr.forEach(function (a) { if (a) CO.imgs.push(a); }); drawCollage(); });
      } }),
      CO.imgs.length ? list : null,
      el("p", { class: "hint", style: "margin-top:8px", text: CO.imgs.length + " of " + need + " photos" }),
      el("div", { class: "group" }, [el("h4", { text: "Layout" }), lay]),
      el("div", { class: "group" }, [el("h4", { text: "Shape" }), ratios]),
      el("div", { class: "group" }, [U.slider({ label: "Gap", min: 0, max: 48, value: CO.gap, reset: 12, onInput: function (v) { CO.gap = v; redraw(); } }).node, U.slider({ label: "Rounded corners", min: 0, max: 80, value: CO.round, reset: 0, onInput: function (v) { CO.round = v; redraw(); } }).node]),
      el("div", { class: "group" }, [el("h4", { text: "Background" }), sw]),
      el("div", { class: "actions" }, [
        el("button", { class: "btn", text: "Download PNG", onclick: function () { U.canvasBlob(cv, "image/png").then(function (b) { U.download(b, "collage-lumio.png"); }).catch(U.fail); } }),
        el("button", { class: "btn", text: "Open in editor", onclick: function () { var c = mk(cv.width, cv.height); c.getContext("2d").drawImage(cv, 0, 0); window.Photo.openImage(c, "collage"); location.hash = "#/photo"; } })
      ])
    ]);
    redraw();
    root.appendChild(el("div", { class: "split" }, [el("div", { class: "stage" }, [el("div", { class: "canvaswrap" }, [el("div", { class: "frame" }, [cv])])]), insp]));
  }

  /* ================= batch ================= */
  var CRC = (function () { var t = new Uint32Array(256), n, k, c; for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { var c = 0xffffffff; for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function makeZip(entries) {
    var parts = [], central = [], offset = 0, enc = new TextEncoder();
    entries.forEach(function (e) {
      var name = enc.encode(e.name), crc = crc32(e.data), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, 0, true); h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true); h.setUint32(18, e.data.length, true); h.setUint32(22, e.data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(h.buffer, name, e.data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, 0, true); c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true); c.setUint32(20, e.data.length, true); c.setUint32(24, e.data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(c.buffer, name);
      offset += 30 + name.length + e.data.length;
    });
    var csize = 0; central.forEach(function (p) { csize += p.byteLength || p.length; });
    var end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, csize, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end.buffer]), { type: "application/zip" });
  }
  var BA = { files: [], preset: "Auto fix", useCurrent: false, res: "orig", fmt: "jpeg", running: false };
  function drawBatch() {
    var root = U.$("#v-batch");
    if (!L.isVip()) { gateCard(root, "Batch enhance is a VIP tool", "Enhance up to 30 photos at once and download them as one ZIP. VIP costs nothing. Sign in to unlock it."); return; }
    U.clear(root);
    var list = el("div", { class: "list" }), rows = [];
    BA.files.forEach(function (f, i) {
      var st = el("span", { class: "st", text: "Waiting" }); rows.push(st);
      list.appendChild(el("div", { class: "it" }, [el("span", { class: "nm", text: f.name }), st, BA.running ? null : el("button", { class: "btn sm ghost", text: "Remove", onclick: function () { BA.files.splice(i, 1); drawBatch(); } })]));
    });
    var presets = el("div", { class: "chips" });
    Object.keys(E.PRESETS).filter(function (n) { return n !== "Reset"; }).forEach(function (n) { presets.appendChild(U.chip(n, !BA.useCurrent && BA.preset === n, function () { BA.preset = n; BA.useCurrent = false; drawBatch(); })); });
    if (window.Photo.hasImage()) presets.appendChild(U.chip("Settings from the photo editor", BA.useCurrent, function () { BA.useCurrent = true; drawBatch(); }));
    var sizes = el("div", { class: "chips" });
    F.RESOLUTIONS.forEach(function (r) { sizes.appendChild(U.chip(r.label, BA.res === r.id, function () { if (!U.gate(r.tier, r.label + " output is a VIP option.")) return; BA.res = r.id; drawBatch(); }, r.tier === "vip" && !L.isVip() ? [U.vipBadge()] : [])); });
    var fm = el("div", { class: "chips" }); [["jpeg", "JPEG"], ["png", "PNG"], ["webp", "WebP"]].forEach(function (f) { fm.appendChild(U.chip(f[1], BA.fmt === f[0], function () { BA.fmt = f[0]; drawBatch(); })); });
    var runBtn = el("button", { class: "btn primary", text: "Enhance " + BA.files.length + " photo" + (BA.files.length === 1 ? "" : "s"), disabled: !BA.files.length || BA.running });
    var bar = el("div", { class: "bar", style: "width:100%", hidden: true }, [el("i")]);
    runBtn.addEventListener("click", function () {
      BA.running = true; runBtn.disabled = true; bar.hidden = false;
      var settings = BA.useCurrent ? window.Photo.settings() : E.sanitize(E.PRESETS[BA.preset]), entries = [], used = {};
      var mime = BA.fmt === "png" ? "image/png" : BA.fmt === "webp" ? "image/webp" : "image/jpeg", ext = BA.fmt === "jpeg" ? "jpg" : BA.fmt;
      var chain = Promise.resolve();
      BA.files.forEach(function (f, i) {
        chain = chain.then(function () {
          rows[i].textContent = "Working…"; bar.firstChild.style.width = Math.round(i / BA.files.length * 100) + "%";
          return U.nextFrame().then(function () { return U.loadImage(f); }).then(function (im) {
            var w = im.naturalWidth, h = im.naturalHeight, rd = F.resById(F.RESOLUTIONS, BA.res), s = rd.short ? rd.short / Math.min(w, h) : 1, ow = Math.round(w * s), oh = Math.round(h * s);
            if (ow * oh > 36e6) throw new Error("Too large for the browser at " + rd.label);
            var c = mk(ow, oh), x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(im, 0, 0, ow, oh);
            var id = x.getImageData(0, 0, ow, oh), st = Object.assign({}, settings); if (s > 1) st.sharpen = Math.max(st.sharpen, 35);
            E.enhance(id, ow, oh, st); x.putImageData(id, 0, 0);
            return U.canvasBlob(c, mime, 0.92);
          }).then(function (blob) { return blob.arrayBuffer(); }).then(function (ab) {
            var base = f.name.replace(/\.[^.]+$/, ""), name = base + "-lumio." + ext, n = 1; while (used[name]) name = base + "-lumio-" + (++n) + "." + ext; used[name] = 1;
            entries.push({ name: name, data: new Uint8Array(ab) }); rows[i].textContent = "Done"; rows[i].className = "st ok";
          }).catch(function (e) { rows[i].textContent = "Skipped: " + U.errMsg(e); rows[i].className = "st bad"; });
        });
      });
      chain.then(function () {
        bar.firstChild.style.width = "100%"; BA.running = false;
        if (!entries.length) { U.toast("No photos could be processed.", "err"); runBtn.disabled = false; return; }
        U.download(makeZip(entries), "lumio-batch.zip"); U.toast(entries.length + " photo" + (entries.length === 1 ? "" : "s") + " saved to lumio-batch.zip.");
        runBtn.disabled = false;
      });
    });
    var insp = el("div", { class: "insp" }, [
      el("h3", { text: "Batch" }),
      el("button", { class: "btn primary", text: "Add photos", onclick: function () { if (BA.running) return; U.pickFile(U.$("#pickPhoto"), true).then(function (fs) { BA.files = BA.files.concat(fs.filter(function (f) { return /^image\//.test(f.type); })).slice(0, 30); drawBatch(); }); } }),
      el("div", { class: "group" }, [el("h4", { text: "Look" }), presets]),
      el("div", { class: "group" }, [el("h4", { text: "Resolution" }), sizes]),
      el("div", { class: "group" }, [el("h4", { text: "Format" }), fm]),
      el("div", { class: "actions" }, [runBtn]), bar
    ]);
    var main = el("div", { class: "stage" }, [el("div", { class: "page", style: "width:100%" }, [
      el("h2", { text: "Batch enhance" }),
      BA.files.length ? list : el("div", { class: "empty", text: "No photos yet. Use “Add photos” to start." })
    ])]);
    root.appendChild(el("div", { class: "split" }, [main, insp]));
  }

  /* ================= formulas ================= */
  function applyFormulaToPhoto(f) {
    var s = E.sanitize(f.settings);
    if (F.settingsNeedVip(s) && !U.gate("vip", "This formula uses VIP filters or styles.")) return;
    function go() { window.Photo.applySettings(s); location.hash = "#/photo"; U.toast("Applied “" + f.name + "”."); }
    if (window.Photo.hasImage()) go();
    else U.pickFile(U.$("#pickPhoto")).then(function (fs) { if (!fs[0]) return; window.Photo.open(fs[0], { settings: s }).then(function () { location.hash = "#/photo"; U.toast("Applied “" + f.name + "”."); }); });
  }
  function drawFormulas() {
    var root = U.$("#v-formulas"); U.clear(root);
    var code = el("input", { type: "text", maxlength: "8", placeholder: "8-character code", autocomplete: "off", "aria-label": "Formula code" }), err = el("p", { class: "err" }), res = el("div");
    var form = el("form", { class: "actions", style: "margin-top:0", onsubmit: function (e) {
      e.preventDefault(); err.textContent = ""; U.clear(res);
      L.api.publicFormula(code.value).then(function (f) {
        res.appendChild(el("div", { class: "note", style: "margin-top:12px" }, [el("b", { text: f.name }), document.createTextNode(f.author ? " by " + f.author : ""), el("div", { class: "actions" }, [el("button", { class: "btn primary sm", type: "button", text: "Apply to a photo", onclick: function () { applyFormulaToPhoto(f); } })])]));
      }).catch(function (x) { err.textContent = U.errMsg(x); });
    } }, [el("div", { class: "field", style: "flex:1;margin:0;min-width:200px" }, [code]), el("button", { class: "btn primary", type: "submit", text: "Find formula" })]);
    var mine = el("div");
    if (!L.isVip()) mine.appendChild(el("div", { class: "empty" }, [el("p", { text: "Sign in to save your own formulas and share them with a code." }), el("div", { class: "actions", style: "justify-content:center" }, [el("button", { class: "btn vip", text: "Sign in for free VIP", onclick: function () { U.authDialog({ tab: "up" }); } })])]));
    else L.api.listFormulas().then(function (fs) {
      if (!fs.length) { mine.appendChild(el("div", { class: "empty", text: "No saved formulas yet. In the photo editor, open Enhance and choose “Save these settings”." })); return; }
      var g = el("div", { class: "cards" });
      fs.forEach(function (f) {
        g.appendChild(el("div", { class: "pcard" }, [el("div", { class: "b" }, [el("b", { text: f.name }), el("small", { text: "Code " }), el("span", { class: "code", text: f.code }),
          el("div", { class: "actions" }, [
            el("button", { class: "btn sm", text: "Apply", onclick: function () { applyFormulaToPhoto(f); } }),
            el("button", { class: "btn sm ghost", text: "Delete", onclick: function () { U.confirm("Delete formula", "Delete “" + f.name + "”? Its share code stops working.", "Delete").then(function (ok) { if (ok) L.api.deleteFormula(f.id).then(drawFormulas).catch(U.fail); }); } })
          ])])]));
      });
      mine.appendChild(g);
    }).catch(function (e) { mine.appendChild(el("p", { class: "err", text: U.errMsg(e) })); });
    root.appendChild(el("div", { class: "page" }, [
      el("h2", { text: "Formulas" }), el("p", { class: "lede", text: "Save a look and share it with a code." }),
      el("div", { class: "section", style: "padding:0 0 24px" }, [el("h3", { text: "Use a code", style: "margin-bottom:10px" }), form, err, res]),
      el("div", { class: "section", style: "padding:0" }, [el("h3", { text: "My formulas", style: "margin-bottom:10px" }), mine])
    ]));
  }

  /* ================= projects ================= */
  function drawProjects() {
    var root = U.$("#v-projects");
    if (!L.isVip()) { gateCard(root, "Projects are a VIP feature", "Save photos and their settings to your account and pick them up later. VIP costs nothing. Sign in to unlock it."); return; }
    U.clear(root);
    var body = el("div", {}, [el("p", { class: "lede", text: "Loading…" })]);
    root.appendChild(el("div", { class: "page" }, [el("h2", { text: "Projects" }), body]));
    L.api.listProjects().then(function (r) {
      U.clear(body);
      body.appendChild(el("p", { class: "lede", text: r.quotaBytes ? U.bytes(r.usageBytes) + " of " + U.bytes(r.quotaBytes) + " used" : r.projects.length + " saved" }));
      if (!r.projects.length) { body.appendChild(el("div", { class: "empty" }, [el("p", { text: "No projects yet. Open a photo, then press Save." }), el("div", { class: "actions", style: "justify-content:center" }, [el("a", { class: "btn primary", href: "#/photo", text: "Open the photo editor" })])])); return; }
      var g = el("div", { class: "cards" });
      r.projects.forEach(function (p) {
        var th = p.thumb ? el("img", { src: p.thumb, alt: "" }) : el("div", { class: "ph" });
        g.appendChild(el("div", { class: "pcard" }, [th, el("div", { class: "b" }, [el("b", { text: p.name }), el("small", { text: new Date(p.updatedAt).toLocaleDateString() }),
          el("div", { class: "actions" }, [
            el("button", { class: "btn sm primary", text: "Open", disabled: !p.hasImage, onclick: function () {
              var b = U.busy("Opening…");
              Promise.all([L.api.getProjectImage(p.id), L.api.getProject(p.id)]).then(function (a) { return window.Photo.openBlob(a[0], p.name, a[1].settings, p.id); }).then(function () { b.done(); location.hash = "#/photo"; }).catch(function (e) { b.done(); U.fail(e); });
            } }),
            el("button", { class: "btn sm ghost", text: "Delete", onclick: function () { U.confirm("Delete project", "Delete “" + p.name + "” and its saved image?", "Delete").then(function (ok) { if (ok) L.api.deleteProject(p.id).then(drawProjects).catch(U.fail); }); } })
          ])])]));
      });
      body.appendChild(g);
    }).catch(function (e) { U.clear(body); body.appendChild(el("p", { class: "err", text: U.errMsg(e) })); });
  }

  /* ================= free vs VIP ================= */
  var STATUS = { ready: null, optional: "Needs the AI worker", "needs-model": "Not built yet", planned: "Planned" };
  function drawPlans() {
    var root = U.$("#v-plans"); U.clear(root);
    function col(tier) {
      var wrap = el("div", { class: "plan" + (tier === "vip" ? " vip" : "") });
      var feats = F.FEATURES.filter(function (f) { return f.tier === tier; });
      wrap.appendChild(el("h3", {}, [document.createTextNode(tier === "vip" ? "VIP" : "Free"), el("span", { class: "badge " + (tier === "vip" ? "vip" : "free"), text: tier === "vip" ? "Free with sign-in" : "No account" })]));
      wrap.appendChild(el("p", { class: "price", text: (tier === "vip" ? "Free with sign-in" : "No account needed") + " · " + feats.length + " features" }));
      F.CATEGORIES.forEach(function (c) {
        var rows = feats.filter(function (f) { return f.category === c.id; }); if (!rows.length) return;
        wrap.appendChild(el("div", { class: "cat", text: c.label }));
        var ul = el("ul", { class: "fl" });
        rows.forEach(function (f) { ul.appendChild(el("li", {}, [el("div", {}, [el("span", { text: f.name }), el("small", { text: f.blurb })]), STATUS[f.status] ? el("span", { class: "badge soon", text: STATUS[f.status] }) : null])); });
        wrap.appendChild(ul);
      });
      if (tier === "vip") wrap.appendChild(el("div", { class: "actions" }, [L.isVip() ? el("span", { class: "badge vip", text: "VIP active on this account" }) : el("button", { class: "btn vip", text: "Sign in for free VIP", onclick: function () { U.authDialog({ tab: "up" }); } })]));
      return wrap;
    }
    root.appendChild(el("div", { class: "page" }, [
      el("h2", { text: "Free and VIP" }), el("p", { class: "lede", text: "Nothing is for sale. VIP unlocks when you sign in." }),
      el("div", { class: "plans" }, [col("free"), col("vip")])
    ]));
  }

  window.Tools = {
    collage: drawCollage, batch: drawBatch, formulas: drawFormulas, projects: drawProjects, plans: drawPlans, makeZip: makeZip, crc32: crc32
  };
})();

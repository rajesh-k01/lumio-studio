/* Shared UI helpers: DOM, icons, toasts, modals, sliders, gating, auth dialog. */
(function () {
  "use strict";
  var L = window.Lumio;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag), k;
    attrs = attrs || {};
    for (k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.indexOf("on") === 0) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] === true) n.setAttribute(k, "");
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }

  var ICONS = {
    enhance: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z",
    retouch: "M12 3a5 5 0 100 10 5 5 0 000-10z M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7",
    color: "M12 3a9 9 0 100 18c1.7 0 2-1 1.5-2-.6-1.2 0-2.5 1.5-2.5H17a4 4 0 004-4c0-5-4-9.5-9-9.5z M7.5 11.5h.01 M10 7.5h.01 M14.5 7.5h.01",
    filters: "M3 6h18 M6 12h12 M10 18h4",
    styles: "M4 20l4-1 10-10-3-3L5 16z M14 6l3 3",
    crop: "M6 3v13a2 2 0 002 2h13 M3 6h13a2 2 0 012 2v13",
    text: "M5 6V4h14v2 M12 4v16 M9 20h6",
    remove: "M3 21l6-6 M14 4l6 6-8 8-6-6z",
    cutout: "M5 5h4 M15 5h4 M5 19h4 M15 19h4 M5 9v6 M19 9v6 M12 9a3 3 0 100 6 3 3 0 000-6z",
    cloud: "M7 18a4 4 0 01-.5-8 6 6 0 0111.6 1.5A3.5 3.5 0 0117.5 18z",
    photo: "M4 5h16v14H4z M4 15l5-5 4 4 3-3 4 4 M9 9h.01",
    video: "M3 6h12v12H3z M15 10l6-3v10l-6-3",
    collage: "M4 4h7v9H4z M13 4h7v5h-7z M13 11h7v9h-7z M4 15h7v5H4z",
    batch: "M8 4h12v12H8z M4 8v12h12",
    formulas: "M9 3h6 M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3",
    projects: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z",
    plans: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z",
    undo: "M9 14L4 9l5-5 M4 9h10a6 6 0 010 12h-3",
    redo: "M15 14l5-5-5-5 M20 9H10a6 6 0 000 12h3",
    split: "M12 3v18 M4 6h5v12H4z M15 6h5v12h-5z",
    export: "M12 3v12 M7 10l5 5 5-5 M5 21h14",
    lock: "M6 11h12v9H6z M8 11V8a4 4 0 018 0v3",
    play: "M7 4l13 8-13 8z",
    pause: "M7 4h4v16H7z M13 4h4v16h-4z",
    save: "M5 3h11l3 3v15H5z M8 3v6h7V3 M8 21v-7h8v7",
    rotl: "M4 12a8 8 0 108-8H8 M8 1L5 4l3 3",
    rotr: "M20 12a8 8 0 11-8-8h4 M16 1l3 3-3 3",
    flip: "M12 3v18 M8 7L3 12l5 5z M16 7l5 5-5 5z",
    music: "M9 18V5l11-2v13 M6 21a3 3 0 100-6 3 3 0 000 6z M17 19a3 3 0 100-6 3 3 0 000 6z",
    trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13",
    plus: "M12 5v14 M5 12h14"
  };
  function icon(name) {
    var ns = "http://www.w3.org/2000/svg", s = document.createElementNS(ns, "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true");
    (ICONS[name] || "").split(" M").forEach(function (d, i) {
      if (!d) return;
      var p = document.createElementNS(ns, "path"); p.setAttribute("d", (i ? "M" : "") + d); s.appendChild(p);
    });
    return s;
  }

  function toast(msg, kind) {
    var t = el("div", { class: "toast" + (kind === "err" ? " err" : ""), text: msg });
    $("#toasts").appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, kind === "err" ? 6500 : 3200);
  }
  function errMsg(e) { return e && e.message ? e.message : "Something went wrong. Try again."; }
  function fail(e) { toast(errMsg(e), "err"); }

  /* busy overlay with optional progress bar */
  var busyNode = null;
  function busy(text, withBar) {
    if (busyNode) busyNode.remove();
    var bar = withBar ? el("div", { class: "bar" }, [el("i")]) : null;
    var msg = el("p", { text: text });
    busyNode = el("div", { class: "busy", role: "alert" }, [el("div", {}, [msg, bar])]);
    document.body.appendChild(busyNode);
    return {
      text: function (t) { msg.textContent = t; },
      progress: function (f) { if (bar) bar.firstChild.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + "%"; },
      done: function () { if (busyNode) { busyNode.remove(); busyNode = null; } }
    };
  }
  function nextFrame() { return new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 0); }); }); }

  /* modal: content is a node; returns {close, card} */
  function modal(content, opt) {
    opt = opt || {};
    var prev = document.activeElement, root = $("#modalRoot");
    var card = el("div", { class: "card" + (opt.wide ? " wide" : ""), role: "dialog", "aria-modal": "true" }, [content]);
    var back = el("div", { class: "modal" }, [card]);
    function close(v) {
      document.removeEventListener("keydown", onKey);
      back.remove();
      if (prev && prev.focus) try { prev.focus(); } catch (e) {}
      if (opt.onClose) opt.onClose(v);
    }
    function onKey(e) {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        var f = $$("button,input,select,textarea,a[href]", card).filter(function (n) { return !n.disabled && n.offsetParent !== null; });
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    back.addEventListener("mousedown", function (e) { if (e.target === back) close(); });
    document.addEventListener("keydown", onKey);
    root.appendChild(back);
    var f0 = $("input,select,textarea,button.primary", card); if (f0) f0.focus();
    return { close: close, card: card };
  }

  function ask(title, label, value, okText) {
    return new Promise(function (resolve) {
      var inp = el("input", { type: "text", maxlength: "80", value: value || "" });
      var done = false;
      var m;
      function finish(v) { if (done) return; done = true; m.close(); resolve(v); }
      var form = el("form", { onsubmit: function (e) { e.preventDefault(); var v = inp.value.trim(); if (v) finish(v); } }, [
        el("h2", { text: title }),
        el("label", { class: "field" }, [el("span", { text: label }), inp]),
        el("div", { class: "actions" }, [
          el("button", { class: "btn primary", type: "submit", text: okText || "Save" }),
          el("button", { class: "btn ghost", type: "button", text: "Cancel", onclick: function () { finish(null); } })
        ])
      ]);
      m = modal(form, { onClose: function () { if (!done) { done = true; resolve(null); } } });
    });
  }
  function confirmBox(title, text, okText) {
    return new Promise(function (resolve) {
      var done = false, m;
      function finish(v) { if (done) return; done = true; m.close(); resolve(v); }
      m = modal(el("div", {}, [
        el("h2", { text: title }), el("p", { class: "lede", text: text }),
        el("div", { class: "actions" }, [
          el("button", { class: "btn primary", text: okText || "Confirm", onclick: function () { finish(true); } }),
          el("button", { class: "btn ghost", text: "Cancel", onclick: function () { finish(false); } })
        ])
      ]), { onClose: function () { if (!done) { done = true; resolve(false); } } });
    });
  }

  /* slider: returns {node, set(v), get()} ; opts.onInput(v), opts.onChange(v) */
  function slider(o) {
    var id = "sl" + Math.random().toString(36).slice(2, 8), val = o.value;
    var out = el("output", { for: id, text: String(val) });
    var inp = el("input", { type: "range", id: id, min: o.min, max: o.max, step: o.step || 1, value: val });
    var locked = o.tier === "vip" && !L.isVip();
    var lab = el("label", { for: id, text: o.label }, locked ? [el("span", { class: "badge vip", text: "VIP" })] : []);
    var node = el("div", { class: "sl" + (locked ? " locked" : "") }, [el("div", { class: "row" }, [lab, out]), inp]);
    inp.addEventListener("input", function () {
      if (locked && !gate("vip", o.why)) { inp.value = val; return; }
      val = Number(inp.value); out.textContent = String(val); if (o.onInput) o.onInput(val);
    });
    inp.addEventListener("change", function () { if (o.onChange) o.onChange(Number(inp.value)); });
    lab.addEventListener("dblclick", function () { inp.value = o.reset == null ? 0 : o.reset; out.textContent = inp.value; val = Number(inp.value); if (o.onInput) o.onInput(val); if (o.onChange) o.onChange(val); });
    return { node: node, set: function (v) { val = v; inp.value = v; out.textContent = String(v); }, get: function () { return val; } };
  }

  function chip(text, pressed, onclick, extra) {
    var b = el("button", { class: "chip", type: "button", "aria-pressed": pressed ? "true" : "false", onclick: onclick }, [text].concat(extra || []));
    return b;
  }
  function vipBadge() { return el("span", { class: "badge vip", text: "VIP" }); }

  /* gating: returns true if allowed now, otherwise opens sign-in / claim */
  function gate(tier, why) {
    if (tier !== "vip" || L.isVip()) return true;
    authDialog({ why: why });
    return false;
  }

  function download(blob, name) {
    var a = el("a", { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }
  function canvasBlob(cv, type, q) {
    return new Promise(function (ok, bad) {
      cv.toBlob(function (b) { b ? ok(b) : bad(new Error("The browser could not encode that image. Try a smaller size or another format.")); }, type, q);
    });
  }
  function loadImage(fileOrBlob) {
    return new Promise(function (ok, bad) {
      var url = URL.createObjectURL(fileOrBlob), im = new Image();
      im.onload = function () { URL.revokeObjectURL(url); ok(im); };
      im.onerror = function () { URL.revokeObjectURL(url); bad(new Error("That file could not be opened as an image.")); };
      im.src = url;
    });
  }
  function pickFile(input, multiple) {
    return new Promise(function (resolve) {
      input.value = ""; input.multiple = !!multiple;
      var onChange = function () { input.removeEventListener("change", onChange); resolve(Array.prototype.slice.call(input.files || [])); };
      input.addEventListener("change", onChange);
      input.click();
    });
  }
  function bytes(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }

  /* ---------- auth dialog ---------- */
  function authDialog(opt) {
    opt = opt || {};
    var tab = opt.tab || "up", m, wrap = el("div"), demo = L.mode === "demo";
    function claimView() {
      clear(wrap);
      wrap.appendChild(el("h2", { text: "Claim your VIP access" }));
      wrap.appendChild(el("p", { class: "lede", text: "VIP is free. Claim it once and every VIP tool opens up." }));
      var e = el("p", { class: "err" });
      wrap.appendChild(e);
      wrap.appendChild(el("div", { class: "actions" }, [
        el("button", { class: "btn vip", text: "Claim VIP", onclick: function () {
          L.api.claimVip().then(function (u) { if (u) L.setUser(u); else L.api.me().then(L.setUser); m.close(); toast("VIP unlocked. Every tool is open."); if (opt.done) opt.done(); }).catch(function (x) { e.textContent = errMsg(x); });
        } }),
        el("button", { class: "btn ghost", text: "Not now", onclick: function () { m.close(); } })
      ]));
    }
    function formView() {
      clear(wrap);
      var up = tab === "up";
      wrap.appendChild(el("h2", { text: opt.why ? "Sign in to unlock this" : (up ? "Create your free account" : "Welcome back") }));
      wrap.appendChild(el("p", { class: "lede", text: (opt.why ? opt.why + " " : "") + "Signing in unlocks every VIP tool. It costs nothing." }));
      var tabs = el("div", { class: "tabs", role: "tablist" }, [
        el("button", { type: "button", role: "tab", "aria-selected": up ? "true" : "false", text: "Create account", onclick: function () { tab = "up"; formView(); } }),
        el("button", { type: "button", role: "tab", "aria-selected": up ? "false" : "true", text: "Sign in", onclick: function () { tab = "in"; formView(); } })
      ]);
      var name = el("input", { type: "text", autocomplete: "name", maxlength: "60", required: true });
      var email = el("input", { type: "email", autocomplete: "email", required: true });
      var pw = el("input", { type: "password", autocomplete: up ? "new-password" : "current-password", minlength: up ? "8" : "1", required: true });
      var err = el("p", { class: "err", role: "alert" });
      var go = el("button", { class: "btn primary", type: "submit", text: up ? "Create account" : "Sign in" });
      var form = el("form", { onsubmit: function (e) {
        e.preventDefault(); err.textContent = ""; go.disabled = true;
        var p = up ? L.api.register(name.value, email.value, pw.value) : L.api.login(email.value, pw.value);
        p.then(function (u) {
          L.setUser(u); m.close();
          if (u && !u.vip) { authDialog({ claim: true, done: opt.done }); return; }
          toast("Signed in. VIP tools are unlocked."); if (opt.done) opt.done();
        }).catch(function (x) { err.textContent = errMsg(x); go.disabled = false; });
      } }, [
        up ? el("label", { class: "field" }, [el("span", { text: "Name" }), name]) : null,
        el("label", { class: "field" }, [el("span", { text: "Email" }), email]),
        el("label", { class: "field" }, [el("span", { text: up ? "Password (8 or more characters)" : "Password" }), pw]),
        err, go
      ]);
      wrap.appendChild(tabs); wrap.appendChild(form);
      if (demo) wrap.appendChild(el("p", { class: "note", text: "Demo mode: this account stays in this browser." }));
    }
    if (opt.claim) claimView(); else formView();
    m = modal(wrap);
    return m;
  }

  /* ---------- header ---------- */
  function renderAuth() {
    var box = $("#authbox"); clear(box);
    if (L.mode === "demo") box.appendChild(el("span", { class: "mode-note", title: "No Lumio server found. Accounts stay in this browser.", text: "Demo mode" }));
    var u = L.user;
    if (!u) {
      box.appendChild(el("button", { class: "btn", text: "Sign in", onclick: function () { authDialog({ tab: "in" }); } }));
      box.appendChild(el("button", { class: "btn vip", text: "Get VIP free", onclick: function () { authDialog({ tab: "up" }); } }));
      return;
    }
    if (!u.vip) box.appendChild(el("button", { class: "btn vip sm", text: "Claim VIP", onclick: function () { authDialog({ claim: true }); } }));
    else box.appendChild(vipBadge());
    var menu = el("button", { class: "btn ghost", "aria-label": "Account menu", onclick: function () { accountDialog(); } }, [
      el("span", { class: "avatar", text: (u.name || u.email || "?").charAt(0).toUpperCase() })
    ]);
    box.appendChild(menu);
  }
  function accountDialog() {
    var u = L.user, m, err = el("p", { class: "err" });
    var pw = el("input", { type: "password", autocomplete: "current-password" });
    var del = el("div", { hidden: true }, [
      el("label", { class: "field" }, [el("span", { text: "Confirm your password to delete the account and all saved projects" }), pw]),
      el("button", { class: "btn", text: "Delete account permanently", onclick: function () {
        L.api.deleteAccount(pw.value).then(function () { L.setUser(null); m.close(); toast("Account deleted."); }).catch(function (x) { err.textContent = errMsg(x); });
      } })
    ]);
    m = modal(el("div", {}, [
      el("h2", { text: u.name }),
      el("p", { class: "lede", text: u.email + (u.vip ? " · VIP" : " · Free") }),
      el("div", { class: "actions" }, [
        el("a", { class: "btn", href: "#/projects", text: "My projects", onclick: function () { m.close(); } }),
        el("a", { class: "btn", href: "#/formulas", text: "My formulas", onclick: function () { m.close(); } }),
        el("button", { class: "btn", text: "Sign out", onclick: function () { L.signOut().then(function () { m.close(); toast("Signed out."); }); } })
      ]),
      el("div", { class: "group", style: "margin-top:18px" }, [
        el("button", { class: "btn ghost sm", text: "Delete my account", onclick: function () { del.hidden = false; pw.focus(); } }), del, err
      ])
    ]));
  }

  window.UI = {
    $: $, $$: $$, el: el, clear: clear, icon: icon, toast: toast, fail: fail, errMsg: errMsg, busy: busy, nextFrame: nextFrame,
    modal: modal, ask: ask, confirm: confirmBox, slider: slider, chip: chip, vipBadge: vipBadge, gate: gate,
    download: download, canvasBlob: canvasBlob, loadImage: loadImage, pickFile: pickFile, bytes: bytes,
    authDialog: authDialog, renderAuth: renderAuth
  };
})();

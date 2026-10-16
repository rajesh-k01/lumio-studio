/*
 * Lumio API client.
 * Server mode: talks to /api/* (cookie session, CSRF header).
 * Demo mode: used when no server answers (opened as a file or hosted statically).
 *   Accounts, projects and formulas live in this browser only.
 */
(function () {
  "use strict";
  var E = window.LumioEngine;

  function ApiError(code, message, status) {
    this.name = "ApiError"; this.code = code; this.message = message; this.status = status || 0;
  }
  ApiError.prototype = Object.create(Error.prototype);

  var Lumio = { mode: "detecting", user: null, health: null, listeners: [] };
  Lumio.onUser = function (fn) { Lumio.listeners.push(fn); };
  function setUser(u) { Lumio.user = u || null; Lumio.listeners.forEach(function (f) { try { f(Lumio.user); } catch (e) { console.error(e); } }); }
  Lumio.isVip = function () { return !!(Lumio.user && Lumio.user.vip); };

  /* ---------------- server backend ---------------- */
  function http(method, url, opt) {
    opt = opt || {};
    var headers = Object.assign({}, opt.headers || {});
    var init = { method: method, credentials: "same-origin", headers: headers };
    if (method !== "GET") headers["X-Requested-With"] = "lumio";
    if (opt.json !== undefined) { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opt.json); }
    if (opt.body !== undefined) { init.body = opt.body; if (opt.type) headers["Content-Type"] = opt.type; }
    return fetch(url, init).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          var e = j && j.error ? j.error : {};
          throw new ApiError(e.code || "http_" + res.status, e.message || "The request failed (" + res.status + ").", res.status);
        });
      }
      return opt.blob ? res.blob().then(function (b) { return { blob: b, res: res }; }) : res.json();
    });
  }

  var server = {
    me: function () { return http("GET", "/api/auth/me").then(function (j) { return j.user; }); },
    register: function (name, email, password) { return http("POST", "/api/auth/register", { json: { name: name, email: email, password: password } }).then(function (j) { return j.user; }); },
    login: function (email, password) { return http("POST", "/api/auth/login", { json: { email: email, password: password } }).then(function (j) { return j.user; }); },
    logout: function () { return http("POST", "/api/auth/logout", { json: {} }); },
    deleteAccount: function (password) { return http("DELETE", "/api/auth/account", { json: { password: password } }); },
    claimVip: function () { return http("POST", "/api/vip/claim", { json: {} }).then(function (j) { return j.user || null; }); },
    listProjects: function () { return http("GET", "/api/projects"); },
    createProject: function (p) { return http("POST", "/api/projects", { json: p }).then(function (j) { return j.project; }); },
    updateProject: function (id, p) { return http("PUT", "/api/projects/" + id, { json: p }).then(function (j) { return j.project; }); },
    getProject: function (id) { return http("GET", "/api/projects/" + id).then(function (j) { return j.project; }); },
    deleteProject: function (id) { return http("DELETE", "/api/projects/" + id); },
    putProjectImage: function (id, blob) { return http("PUT", "/api/projects/" + id + "/image", { body: blob, type: blob.type || "image/png" }); },
    getProjectImage: function (id) { return http("GET", "/api/projects/" + id + "/image", { blob: true }).then(function (r) { return r.blob; }); },
    listFormulas: function () { return http("GET", "/api/formulas").then(function (j) { return j.formulas; }); },
    createFormula: function (name, settings) { return http("POST", "/api/formulas", { json: { name: name, settings: settings } }).then(function (j) { return j.formula; }); },
    deleteFormula: function (id) { return http("DELETE", "/api/formulas/" + id); },
    publicFormula: function (code) { return http("GET", "/api/formulas/public/" + encodeURIComponent(String(code).trim().toUpperCase())).then(function (j) { return j.formula; }); },
    render: function (blob, settings, o) {
      o = o || {};
      var q = "?scale=" + (o.scale || 1) + (o.target ? "&target=" + o.target : "") + "&format=" + (o.format || "png") + (o.quality ? "&quality=" + o.quality : "") + (o.neural ? "&neural=1" : "") + (o.force ? "&force=1" : "") + (o.faces ? "&faces=" + o.faces : "");
      return http("POST", "/api/process" + q, { body: blob, type: blob.type || "image/png", headers: { "X-Lumio-Settings": encodeURIComponent(JSON.stringify(settings || {})) }, blob: true })
        .then(function (r) { return { blob: r.blob, neural: r.res.headers.get("X-Lumio-Neural") || "off", capped: r.res.headers.get("X-Lumio-Capped") === "1" || r.res.headers.get("X-Lumio-Capped") === "true" }; });
    },
    renderVideo: function (file, settings, o) {
      o = o || {};
      var q = "?target=" + o.target + "&speed=" + (o.speed || 1) + "&mirror=" + (o.mirror ? 1 : 0) + "&start=" + (o.start || 0) + (o.end ? "&end=" + o.end : "") + (o.ai ? "&ai=1" : "");
      return http("POST", "/api/video/enhance" + q, { body: file, type: file.type || "video/mp4", headers: { "X-Lumio-Settings": encodeURIComponent(JSON.stringify(settings || {})) }, blob: true })
        .then(function (r) { return { blob: r.blob, skipped: r.res.headers.get("X-Lumio-Skipped") || "", capped: r.res.headers.get("X-Lumio-Capped") === "1", width: r.res.headers.get("X-Lumio-Width"), height: r.res.headers.get("X-Lumio-Height"), neural: r.res.headers.get("X-Lumio-Neural") || "off" }; });
    },
    aiUpscale: function (blob, scale, natural, faces) { return http("POST", "/api/ai/upscale?scale=" + (Math.round((scale || 2) * 100) / 100) + (natural ? "&natural=" + natural : "") + (faces ? "&faces=" + faces : ""), { body: blob, type: blob.type || "image/png", blob: true }).then(function (r) { return r.blob; }); }
  };

  /* ---------------- demo (device-only) backend ---------------- */
  function ls(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { throw new ApiError("storage_full", "This browser could not save that. Free some space and try again."); } }
  function b64(buf) { var s = ""; new Uint8Array(buf).forEach(function (c) { s += String.fromCharCode(c); }); return btoa(s); }
  function rand(n) { var a = new Uint8Array(n); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; }); return a; }
  function hashPw(pw, salt) {
    var subtle = window.crypto && crypto.subtle;
    if (!subtle) { // demo-only fallback when the page is not a secure context
      var h = 2166136261, s = salt + pw;
      for (var r = 0; r < 5000; r++) for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
      return Promise.resolve("weak:" + h.toString(16));
    }
    return subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]).then(function (k) {
      return subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 120000 }, k, 256);
    }).then(b64);
  }
  function pub(u) {
    return { id: u.email, email: u.email, name: u.name, tier: u.tier, vip: u.tier === "vip", vipSince: u.vipSince || null };
  }
  function curEmail() { return ls("lumio.session", null); }
  function curUser() { var e = curEmail(), u = e && ls("lumio.users", {})[e]; return u ? Object.assign({ email: e }, u) : null; }
  function needUser() { var u = curUser(); if (!u) throw new ApiError("auth_required", "Sign in to continue.", 401); return u; }
  function needVip() { var u = needUser(); if (u.tier !== "vip") throw new ApiError("vip_required", "Sign in and claim VIP to use this.", 403); return u; }

  var idb = null;
  function db() {
    if (idb) return idb;
    idb = new Promise(function (ok, bad) {
      if (!window.indexedDB) return bad(new ApiError("storage_unavailable", "This browser blocks local storage for projects."));
      var r = indexedDB.open("lumio-demo", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("projects", { keyPath: "id", autoIncrement: true }); };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { bad(new ApiError("storage_unavailable", "This browser blocks local storage for projects.")); };
    });
    return idb;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (ok, bad) {
        var t = d.transaction("projects", mode), s = t.objectStore("projects"), out = fn(s);
        t.oncomplete = function () { ok(out && out.result !== undefined ? out.result : undefined); };
        t.onerror = function () { bad(new ApiError("storage_error", "Saving to this browser failed.")); };
      });
    });
  }
  function projOut(p) { return { id: p.id, name: p.name, mode: p.mode, thumb: p.thumb || null, hasImage: !!p.blob, settings: p.settings, createdAt: p.createdAt, updatedAt: p.updatedAt }; }
  function allProjects(email) { return tx("readonly", function (s) { return s.getAll(); }).then(function (a) { return (a || []).filter(function (p) { return p.user === email; }); }); }
  function oneProject(id, email) {
    return tx("readonly", function (s) { return s.get(Number(id)); }).then(function (p) {
      if (!p || p.user !== email) throw new ApiError("not_found", "Project not found.", 404);
      return p;
    });
  }

  var local = {
    me: function () { var u = curUser(); return Promise.resolve(u ? pub(u) : null); },
    register: function (name, email, password) {
      email = String(email || "").trim().toLowerCase();
      if (!name || !String(name).trim()) return Promise.reject(new ApiError("invalid_name", "Enter your name."));
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Promise.reject(new ApiError("invalid_email", "Enter a valid email address."));
      if (!password || password.length < 8) return Promise.reject(new ApiError("invalid_password", "Use a password of at least 8 characters."));
      var users = ls("lumio.users", {});
      if (users[email]) return Promise.reject(new ApiError("email_taken", "An account with this email already exists on this device. Sign in instead."));
      var salt = b64(rand(16));
      return hashPw(password, salt).then(function (h) {
        users[email] = { name: String(name).trim().slice(0, 60), salt: salt, hash: h, tier: "vip", vipSince: Date.now() };
        lsSet("lumio.users", users); lsSet("lumio.session", email);
        return pub(Object.assign({ email: email }, users[email]));
      });
    },
    login: function (email, password) {
      email = String(email || "").trim().toLowerCase();
      var u = ls("lumio.users", {})[email];
      var salt = u ? u.salt : "x";
      return hashPw(password || "", salt).then(function (h) {
        if (!u || u.hash !== h) throw new ApiError("wrong_credentials", "Wrong email or password.", 401);
        lsSet("lumio.session", email);
        return pub(Object.assign({ email: email }, u));
      });
    },
    logout: function () { try { localStorage.removeItem("lumio.session"); } catch (e) {} return Promise.resolve({ ok: true }); },
    deleteAccount: function (password) {
      var u = needUser();
      return hashPw(password || "", u.salt).then(function (h) {
        if (h !== u.hash) throw new ApiError("wrong_credentials", "Wrong password.", 401);
        var users = ls("lumio.users", {}); delete users[u.email]; lsSet("lumio.users", users);
        try { localStorage.removeItem("lumio.session"); localStorage.removeItem("lumio.formulas." + u.email); } catch (e) {}
        return allProjects(u.email).then(function (ps) { return tx("readwrite", function (s) { ps.forEach(function (p) { s.delete(p.id); }); }); }).then(function () { return { ok: true }; });
      });
    },
    claimVip: function () { return Promise.resolve(pub(needUser())); },
    listProjects: function () {
      var u = needVip();
      return allProjects(u.email).then(function (ps) {
        ps.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
        var used = ps.reduce(function (n, p) { return n + (p.blob ? p.blob.size : 0); }, 0);
        return { projects: ps.map(projOut), usageBytes: used, quotaBytes: 0 };
      });
    },
    createProject: function (p) {
      var u = needVip(), now = Date.now();
      var rec = { user: u.email, name: String(p.name || "").trim().slice(0, 80), mode: p.mode === "video" ? "video" : "photo", settings: E.sanitize(p.settings), thumb: p.thumb || null, blob: null, createdAt: now, updatedAt: now };
      if (!rec.name) return Promise.reject(new ApiError("invalid_name", "Give the project a name up to 80 characters."));
      return tx("readwrite", function (s) { return s.add(rec); }).then(function (id) { rec.id = id; return projOut(rec); });
    },
    updateProject: function (id, p) {
      var u = needVip();
      return oneProject(id, u.email).then(function (rec) {
        if (p.name !== undefined) rec.name = String(p.name).slice(0, 80);
        if (p.settings !== undefined) rec.settings = E.sanitize(p.settings);
        if (p.thumb !== undefined) rec.thumb = p.thumb;
        rec.updatedAt = Date.now();
        return tx("readwrite", function (s) { s.put(rec); }).then(function () { return projOut(rec); });
      });
    },
    getProject: function (id) { var u = needVip(); return oneProject(id, u.email).then(projOut); },
    deleteProject: function (id) { var u = needVip(); return oneProject(id, u.email).then(function () { return tx("readwrite", function (s) { s.delete(Number(id)); }); }).then(function () { return { ok: true }; }); },
    putProjectImage: function (id, blob) {
      var u = needVip();
      return oneProject(id, u.email).then(function (rec) { rec.blob = blob; rec.updatedAt = Date.now(); return tx("readwrite", function (s) { s.put(rec); }); }).then(function () { return { ok: true, size: blob.size }; });
    },
    getProjectImage: function (id) { var u = needVip(); return oneProject(id, u.email).then(function (rec) { if (!rec.blob) throw new ApiError("no_image", "This project has no saved image.", 404); return rec.blob; }); },
    listFormulas: function () { var u = needVip(); return Promise.resolve(ls("lumio.formulas." + u.email, [])); },
    createFormula: function (name, settings) {
      var u = needVip(); name = String(name || "").trim();
      if (!name || name.length > 60) return Promise.reject(new ApiError("invalid_name", "Give the formula a name up to 60 characters."));
      var alpha = "ABCDEFGHJKMNPQRSTVWXYZ23456789", code = "";
      rand(8).forEach(function (b) { code += alpha[b % alpha.length]; });
      var list = ls("lumio.formulas." + u.email, []), f = { id: Date.now(), name: name, code: code, settings: E.sanitize(settings), createdAt: Date.now() };
      list.unshift(f); lsSet("lumio.formulas." + u.email, list);
      var idx = ls("lumio.formulaCodes", {}); idx[code] = { name: name, author: u.name, settings: f.settings }; lsSet("lumio.formulaCodes", idx);
      return Promise.resolve(f);
    },
    deleteFormula: function (id) {
      var u = needVip(), list = ls("lumio.formulas." + u.email, []), f = list.filter(function (x) { return x.id === id; })[0];
      if (!f) return Promise.reject(new ApiError("not_found", "Formula not found.", 404));
      lsSet("lumio.formulas." + u.email, list.filter(function (x) { return x.id !== id; }));
      var idx = ls("lumio.formulaCodes", {}); delete idx[f.code]; lsSet("lumio.formulaCodes", idx);
      return Promise.resolve({ ok: true });
    },
    publicFormula: function (code) {
      code = String(code || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{8}$/.test(code)) return Promise.reject(new ApiError("invalid_code", "A formula code has 8 letters and digits."));
      var f = ls("lumio.formulaCodes", {})[code];
      if (!f) return Promise.reject(new ApiError("not_found", "No formula with that code on this device. Codes made on other devices need the Lumio server."));
      return Promise.resolve({ name: f.name, author: f.author, settings: E.sanitize(f.settings) });
    },
    render: function () { return Promise.reject(new ApiError("server_only", "Cloud render needs the Lumio server. Your device renders locally instead.")); },
    renderVideo: function () { return Promise.reject(new ApiError("server_only", "Server video render needs the Lumio server with FFmpeg.")); },
    aiUpscale: function () { return Promise.reject(new ApiError("server_only", "Neural upscale needs the Lumio server with the AI worker turned on.")); }
  };

  /* ---------------- bootstrap ---------------- */
  Lumio.ApiError = ApiError;
  Lumio.api = local;
  Lumio.init = function () {
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 1500);
    var isHttp = /^https?:$/.test(location.protocol);
    var probe;
    try {
      probe = isHttp ? fetch("/api/health", { credentials: "same-origin", signal: ctl ? ctl.signal : undefined }).then(function (r) {
        if (!r.ok) throw new Error("no api");
        return r.json();
      }) : Promise.reject(new Error("not http"));
    } catch (e) { probe = Promise.reject(e); }
    return probe.then(function (h) {
      if (!h || h.name !== "lumio") throw new Error("not lumio");
      Lumio.mode = "server"; Lumio.health = h; Lumio.api = server;
      return server.me().catch(function () { return null; });
    }).catch(function () {
      Lumio.mode = "demo"; Lumio.api = local;
      return local.me();
    }).then(function (u) { clearTimeout(timer); setUser(u); return u; });
  };

  Lumio.signOut = function () { return Lumio.api.logout().then(function () { setUser(null); }); };
  Lumio.setUser = setUser;
  window.Lumio = Lumio;
})();

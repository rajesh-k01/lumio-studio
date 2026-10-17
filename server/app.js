"use strict";
const path = require("path");
const express = require("express");
const features = require("../public/js/features.js");
const { HttpError } = require("./util");
const { createSessionStore, csrfGuard } = require("./auth");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

function securityHeaders(req, res, next) {
  res.set({
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'"
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  });
  next();
}

function createApp(cfg, db) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", process.env.TRUST_PROXY === "1");
  app.use(securityHeaders);

  const sessions = createSessionStore(db, cfg);
  const ctx = { db, cfg, sessions, neural: require("./neural")(cfg) };

  const api = express.Router();
  api.use(express.json({ limit: "400kb" }));
  api.use(sessions.middleware());
  api.use(csrfGuard);

  const video = require("./routes/video")(ctx);
  api.get("/health", (req, res) => res.json({ ok: true, name: "lumio", vipPolicy: cfg.vipPolicy, ai: cfg.aiWorker, faces: cfg.aiWorker && cfg.aiEngine === "realesrgan" && cfg.aiFaces, ffmpeg: video.available }));
  api.get("/features", (req, res) => {
    res.json({
      features: features.FEATURES, filters: features.FILTERS, styles: features.STYLES, categories: features.CATEGORIES,
      summary: features.summary(), vipPolicy: cfg.vipPolicy, user: req.user,
      entitlements: { tier: req.user && req.user.vip ? "vip" : "free" }
    });
  });
  api.use("/auth", require("./routes/auth")(ctx));
  api.use("/vip", require("./routes/vip")(ctx));
  api.use("/projects", require("./routes/projects")(ctx));
  api.use("/formulas", require("./routes/formulas")(ctx));
  api.use("/", video);
  api.use("/", require("./routes/process")(ctx));
  api.use((req, res, next) => next(new HttpError(404, "not_found", "No such API route.")));
  app.use("/api", api);

  app.use(express.static(PUBLIC_DIR, { extensions: ["html"], maxAge: "1h" }));
  app.get(/^\/(?!api(\/|$))[^.]*$/, (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

  app.use((err, req, res, next) => {
    let status = err.status || 500, code = err.code || "server_error", message = err.message;
    if (err.type === "entity.parse.failed") { status = 400; code = "invalid_json"; message = "The request body is not valid JSON."; }
    else if (err.type === "entity.too.large") { status = 413; code = "too_large"; message = "The request is too large."; }
    else if (!(err instanceof HttpError) && status >= 500) {
      console.error(err);
      message = "Something went wrong on the server.";
    }
    res.status(status).json({ error: { code, message } });
  });

  return { app, sessions };
}

module.exports = { createApp };

"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const sharp = require("sharp");
const engine = require("../../public/js/engine.js");
const features = require("../../public/js/features.js");
const { HttpError, wrap, intParam } = require("../util");
const { requireVip } = require("../auth");
const { rateLimit } = require("../ratelimit");
const { createJobRunner } = require("../jobs");

const FORMATS = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };

module.exports = function processRoutes({ cfg, neural }) {
  const r = express.Router();
  const run = createJobRunner(cfg.workerConcurrency);
  const raw = express.raw({ type: "image/*", limit: cfg.maxUploadBytes });
  const sharpOpts = { limitInputPixels: cfg.maxInputPixels, failOn: "error" };

  const guard = [requireVip, rateLimit({ windowMs: 60 * 1000, max: 30, key: (req) => "u" + req.user.id })];

  function bodyOf(req) {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(415, "image_required", "Send the image as the request body with an image/* content type.");
    return req.body;
  }
  function settingsOf(req) {
    const h = req.get("x-lumio-settings");
    if (!h) return engine.sanitize({});
    try { return engine.sanitize(JSON.parse(decodeURIComponent(h))); }
    catch (_) { throw new HttpError(400, "invalid_settings", "X-Lumio-Settings must be URL-encoded JSON."); }
  }
  async function dimsOf(body) {
    let meta;
    try { meta = await sharp(body, sharpOpts).metadata(); }
    catch (_) { throw new HttpError(400, "invalid_image", "That file is not a readable image."); }
    let w = meta.width, h = meta.height;
    if (meta.orientation >= 5) { const t = w; w = h; h = t; }
    return { w, h };
  }

  /* Enhance and upscale on the server. Settings: X-Lumio-Settings header. Query: scale, format, quality. */
  r.post("/process", guard, raw, wrap(async (req, res) => {
    const body = bodyOf(req), settings = settingsOf(req);
    const { w: sw, h: sh } = await dimsOf(body);
    // "target" is the wanted short side in pixels (1080 = HD, 1440 = 2K, 2160 = 4K, 4320 = 8K). It wins over "scale".
    const target = intParam(req.query.target, 0, 0, 8640);
    const scale = target ? Math.min(200, Math.max(0.05, target / Math.min(sw, sh))) : intParam(req.query.scale, 2, 1, 8);
    const format = FORMATS[req.query.format] ? req.query.format : "png";
    const quality = intParam(req.query.quality, 90, 40, 100);
    const limit = Math.min(scale, cfg.maxImageSide / Math.max(sw, sh), Math.sqrt(cfg.maxOutputPixels / (sw * sh)));
    const tw = Math.max(1, Math.round(sw * limit)), th = Math.max(1, Math.round(sh * limit));

    // The network is 4x native, so it runs at no more than 4x (faces too: GFPGAN on a 33 MP image failed); anything bigger is a Lanczos resize of that result.
    // neural=1 asks for the AI pipeline (Real-ESRGAN, plus GFPGAN faces when faces>0) instead of a plain resize.
    // Whatever cannot be done is reported in X-Lumio-Neural and the normal filter path is used, so an export never fails for that.
    let neuralState = "off", neuralFile = null;
    const facesAsked = Math.min(1, Math.max(0, Number(req.query.faces) || 0));
    if (req.query.neural === "1") {
      if (!cfg.aiWorker) neuralState = "unavailable";
      else if (sw * sh > cfg.aiMaxPixels) neuralState = "too-large";
      else if (limit < 1.05 && req.query.force !== "1") neuralState = "not-needed";
      else {
        const inFile = path.join(os.tmpdir(), "lumio-" + crypto.randomBytes(8).toString("hex") + "-pin.png");
        try {
          await sharp(body, sharpOpts).rotate().png().toFile(inFile);
          const r2 = await neural.image(inFile, Math.min(4, Math.max(1, limit)), { natural: 0.25, faces: facesAsked });
          neuralFile = r2.file; neuralState = r2.done.faces ? "ai+faces" : "ai";
        } finally { fs.rm(inFile, { force: true }, () => {}); }
      }
    }
    let pipe, data, info;
    try {
      pipe = neuralFile ? sharp(neuralFile, sharpOpts) : sharp(body, sharpOpts).rotate();
      if (neuralFile) { const m2 = await pipe.metadata(); if (m2.width !== tw || m2.height !== th) pipe = pipe.resize(tw, th, { kernel: "lanczos3", fit: "fill" }); }
      else if (tw !== sw || th !== sh) pipe = pipe.resize(tw, th, { kernel: "lanczos3", fit: "fill" });
      ({ data, info } = await pipe.ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
    } finally { if (neuralFile) fs.rm(neuralFile, { force: true }, () => {}); }
    // After the neural pass: most noise is already gone, and the network already adds crisp detail, so the extra
    // sharpen and clarity are dropped and the "natural finish" stage (fitted on a reference result) calms the rest.
    const eff = neuralFile ? Object.assign({}, settings, { denoise: Math.round(settings.denoise * 0.3), sharpen: 0, clarity: 0, natural: 100, calm: 100 }) : settings;
    const out = await run(data, { kind: "enhance", width: info.width, height: info.height, settings: eff });

    let enc = sharp(out.data, { raw: { width: info.width, height: info.height, channels: 4 } });
    if (format === "jpeg") enc = enc.flatten({ background: "#ffffff" }).jpeg({ quality });
    else if (format === "webp") enc = enc.webp({ quality });
    else enc = enc.png({ compressionLevel: 6 });
    const bytes = await enc.toBuffer();

    res.set({
      "Content-Type": FORMATS[format],
      "Cache-Control": "no-store",
      "X-Lumio-Width": String(info.width),
      "X-Lumio-Height": String(info.height),
      "X-Lumio-Scale": String(Math.round(limit * 100) / 100),
      "X-Lumio-Capped": limit < scale - 1e-9 ? "1" : "0",
      "X-Lumio-Neural": neuralState
    });
    res.send(bytes);
  }));

  /* Background cutout from a clicked point. Query: x, y (0 to 1), tol (1 to 100). Returns a PNG with alpha. */
  r.post("/cutout", guard, raw, wrap(async (req, res) => {
    const body = bodyOf(req);
    const nx = intParam(req.query.x, 0, 0, 1), ny = intParam(req.query.y, 0, 0, 1), tol = intParam(req.query.tol, 35, 1, 100);
    const { w, h } = await dimsOf(body);
    if (w * h > cfg.maxOutputPixels) throw new HttpError(413, "image_too_large", "That image has too many pixels for cutout. Resize it first.");
    const { data, info } = await sharp(body, sharpOpts).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const x = Math.min(info.width - 1, Math.floor(nx * info.width)), y = Math.min(info.height - 1, Math.floor(ny * info.height));
    const out = await run(data, { kind: "cutout", width: info.width, height: info.height, x, y, thr: 8 + tol * 2.6 });
    if (out.removed > info.width * info.height * 0.97) throw new HttpError(422, "whole_image", "That would remove almost the whole photo. Lower the tolerance or click the background.");
    const png = await sharp(out.data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    res.set({ "Content-Type": "image/png", "Cache-Control": "no-store", "X-Lumio-Removed": String(out.removed) });
    res.send(png);
  }));

  /* Optional neural upscaling. Engine "realesrgan" runs ai/realesrgan.py (Real-ESRGAN, any output factor 1 to 8).
     Engine "edsr" runs ai/upscale.py (EDSR, factor 2, 3 or 4). Enable with LUMIO_AI=1, see docs/AI_WORKER.md. */
  r.post("/ai/upscale", guard, raw, wrap(async (req, res) => {
    if (!cfg.aiWorker) throw new HttpError(501, "ai_unavailable", "Neural upscaling is not enabled on this server. See docs/AI_WORKER.md.");
    const body = bodyOf(req), edsr = cfg.aiEngine === "edsr";
    const asked = Number(req.query.scale) || 2, scale = edsr ? (asked <= 2 ? 2 : asked <= 3 ? 3 : 4) : Math.min(8, Math.max(1, asked));
    const natural = Math.min(1, Math.max(0, Number(req.query.natural) || 0));
    const faces = Math.min(1, Math.max(0, Number(req.query.faces) || 0));
    const { w, h } = await dimsOf(body);
    if (w * h > cfg.aiMaxPixels) throw new HttpError(413, "image_too_large", "Neural upscaling accepts images up to " + (cfg.aiMaxPixels / 1e6).toFixed(2) + " megapixels. Resize it first, or raise LUMIO_AI_MAX_PIXELS on a faster machine.");
    const inFile = path.join(os.tmpdir(), "lumio-" + crypto.randomBytes(8).toString("hex") + "-in.png");
    let result;
    try {
      await sharp(body, sharpOpts).rotate().png().toFile(inFile);
      result = await neural.image(inFile, scale, { natural, faces });
      res.set({ "Content-Type": "image/png", "Cache-Control": "no-store", "X-Lumio-Faces": result.done.faces ? "1" : "0" });
      res.send(fs.readFileSync(result.file));
    } finally {
      fs.rm(inFile, { force: true }, () => {});
      if (result) fs.rm(result.file, { force: true }, () => {});
    }
  }));

  return r;
};

module.exports.needsVip = features.settingsNeedVip;

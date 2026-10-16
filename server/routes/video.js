"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { pipeline } = require("stream/promises");
const { Transform } = require("stream");
const express = require("express");
const { HttpError, wrap, intParam } = require("../util");
const { requireVip } = require("../auth");
const { rateLimit } = require("../ratelimit");
const { buildFilters, atempoChain, even } = require("../ffmpegFilters");
const engine = require("../../public/js/engine.js");

/* Server-side video render with FFmpeg: frame-accurate, any size up to 8K, keeps audio. */
module.exports = function videoRoutes({ cfg, neural }) {
  const r = express.Router();
  let available = false, running = 0;
  if (cfg.videoWorker) {
    execFile(cfg.ffmpegBin, ["-version"], (e1) => {
      if (e1) return;
      execFile(cfg.ffprobeBin, ["-version"], (e2) => { available = !e2; });
    });
  }
  Object.defineProperty(r, "available", { get: () => available });

  const guard = [requireVip, rateLimit({ windowMs: 60 * 1000, max: 6, key: (req) => "v" + req.user.id })];

  function saveUpload(req, file, limit) {
    let n = 0;
    const counter = new Transform({
      transform(chunk, enc, cb) { n += chunk.length; if (n > limit) cb(new HttpError(413, "video_too_large", "That video is over " + Math.round(limit / 1048576) + " MB. Trim it first.")); else cb(null, chunk); }
    });
    return pipeline(req, counter, fs.createWriteStream(file)).then(() => n);
  }
  function probe(file) {
    return new Promise((resolve, reject) => {
      execFile(cfg.ffprobeBin, ["-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate:format=duration", "-of", "json", file], { timeout: 30000 }, (err, out) => {
        if (err) return reject(new HttpError(400, "invalid_video", "That file is not a readable video."));
        try {
          const j = JSON.parse(out), v = (j.streams || []).find((s) => s.codec_type === "video");
          if (!v || !v.width || !v.height) throw new Error("no video");
          const [a, b] = String(v.r_frame_rate || "24/1").split("/").map(Number);
          resolve({ w: v.width, h: v.height, fps: b ? a / b : 24, hasAudio: (j.streams || []).some((s) => s.codec_type === "audio"), duration: Number((j.format || {}).duration) || 0 });
        } catch (_) { reject(new HttpError(400, "invalid_video", "That file is not a readable video.")); }
      });
    });
  }
  function ffmpeg(args) {
    return new Promise((resolve, reject) => {
      execFile(cfg.ffmpegBin, args, { timeout: cfg.videoTimeoutMs, maxBuffer: 1 << 20 }, (err, so, se) => {
        if (err) return reject(new HttpError(err.killed ? 504 : 502, err.killed ? "video_timeout" : "video_failed", err.killed ? "The render took too long. Try a lower resolution or a shorter clip." : "FFmpeg could not render this video: " + String(se || err.message).trim().split("\n").slice(-1)[0].slice(0, 200)));
        resolve();
      });
    });
  }

  /* Query: target (short side in px: 720 to 4320), speed (0.25 to 4), mirror (0 or 1), start, end (seconds). */
  r.post("/video/enhance", guard, wrap(async (req, res) => {
    if (!available) throw new HttpError(501, "video_unavailable", "Server video render needs FFmpeg on the server. See docs/VIDEO_WORKER.md.");
    if (!/^video\//.test(String(req.get("content-type") || ""))) throw new HttpError(415, "video_required", "Send the video as the request body with a video/* content type.");
    if (running >= cfg.videoConcurrency) throw new HttpError(429, "busy", "The video renderer is busy. Try again in a minute.");
    running++;
    const id = crypto.randomBytes(8).toString("hex"), inFile = path.join(os.tmpdir(), "lumio-" + id + "-in"), outFile = path.join(os.tmpdir(), "lumio-" + id + "-out.mp4");
    try {
      let settings;
      try { settings = engine.sanitize(JSON.parse(decodeURIComponent(req.get("x-lumio-settings") || "{}"))); }
      catch (_) { throw new HttpError(400, "invalid_settings", "X-Lumio-Settings must be URL-encoded JSON."); }
      await saveUpload(req, inFile, cfg.maxVideoBytes);
      const info = await probe(inFile);
      if (info.duration > cfg.maxVideoSeconds) throw new HttpError(413, "video_too_long", "Clips can be up to " + Math.round(cfg.maxVideoSeconds / 60) + " minutes. Trim it first.");

      const target = intParam(req.query.target, 1080, 240, 4320), speed = intParam(req.query.speed, 1, 0.25, 4), mirror = req.query.mirror === "1";
      const start = intParam(req.query.start, 0, 0, Math.max(0, info.duration - 0.2));
      const end = intParam(req.query.end, info.duration, start + 0.2, Math.max(start + 0.2, info.duration));
      let k = target / Math.min(info.w, info.h), capped = false;
      if (info.w * info.h * k * k > cfg.maxVideoPixels) { k = Math.sqrt(cfg.maxVideoPixels / (info.w * info.h)); capped = true; }
      const outW = even(info.w * k), outH = even(info.h * k);
      const { vf, skipped } = buildFilters(settings, { outW, outH, fps: info.fps, mirror, speed });

      const dur = Math.max(0.2, end - start), enc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];

      // ai=1: enhance every frame with Real-ESRGAN, then encode. Anything that cannot be done is reported in X-Lumio-Neural
      // and the normal FFmpeg render is used, so the request never fails for that.
      let aiState = "off";
      if (req.query.ai === "1") {
        const nFrames = Math.ceil(dur * info.fps), short = Math.min(info.w, info.h), k0 = Math.min(1, cfg.videoAiMaxShort / short);
        const inW = even(info.w * k0), inH = even(info.h * k0), factor = Math.min(8, Math.max(1, outW / inW));
        if (!cfg.aiWorker || cfg.aiEngine !== "realesrgan") aiState = "unavailable";
        else if (nFrames > cfg.videoAiMaxFrames) aiState = "too-long";
        else if (factor < 1.05) aiState = "not-needed";
        else {
          const dir = path.join(os.tmpdir(), "lumio-" + id + "-frames"), dIn = path.join(dir, "in"), dOut = path.join(dir, "out");
          try {
            fs.mkdirSync(dIn, { recursive: true }); fs.mkdirSync(dOut, { recursive: true });
            // hqdn3d is a light temporal denoise: it keeps noise from flickering once the network adds detail to each frame.
            await ffmpeg(["-v", "error", "-y", "-ss", String(start), "-i", inFile, "-t", String(dur), "-vf", "hqdn3d=1.5:1.2:4:3,scale=" + inW + ":" + inH + ":flags=lanczos", "-an", path.join(dIn, "%06d.png")]);
            await neural.frames(dIn, dOut, factor, { natural: 0.2, timeoutMs: cfg.videoTimeoutMs });
            const args = ["-v", "error", "-y", "-framerate", String(info.fps), "-i", path.join(dOut, "%06d.png")];
            if (info.hasAudio) args.push("-ss", String(start), "-t", String(dur), "-i", inFile);
            args.push("-vf", vf, "-map", "0:v:0");
            if (info.hasAudio) args.push("-map", "1:a:0", "-af", atempoChain(speed), "-c:a", "aac", "-b:a", "192k", "-ac", "2"); else args.push("-an");
            args.push.apply(args, enc); args.push(outFile);
            await ffmpeg(args);
            aiState = "ai";
          } finally { fs.rm(dir, { recursive: true, force: true }, () => {}); }
        }
      }
      if (aiState !== "ai") {
        const args = ["-v", "error", "-y", "-ss", String(start), "-i", inFile, "-t", String(dur), "-vf", vf].concat(enc);
        if (info.hasAudio) args.push("-af", atempoChain(speed), "-c:a", "aac", "-b:a", "192k", "-ac", "2"); else args.push("-an");
        args.push(outFile);
        await ffmpeg(args);
      }

      res.set({ "Content-Type": "video/mp4", "Cache-Control": "no-store", "X-Lumio-Width": String(outW), "X-Lumio-Height": String(outH), "X-Lumio-Capped": capped ? "1" : "0", "X-Lumio-Skipped": skipped.join(", "), "X-Lumio-Neural": aiState });
      await new Promise((ok, bad) => res.sendFile(outFile, (err) => (err ? bad(err) : ok())));
    } finally {
      running--;
      fs.rm(inFile, { force: true }, () => {}); fs.rm(outFile, { force: true }, () => {});
    }
  }));

  return r;
};

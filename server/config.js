"use strict";
const path = require("path");

/* All settings come from environment variables. Tests pass overrides. */
function loadConfig(overrides) {
  const env = process.env;
  return Object.assign({
    port: Number(env.PORT) || 3000,
    dbFile: env.LUMIO_DB || path.join(__dirname, "..", "data", "lumio.db"),
    // "auto": signing up unlocks VIP immediately. "claim": the user must also call POST /api/vip/claim.
    vipPolicy: env.LUMIO_VIP_POLICY === "claim" ? "claim" : "auto",
    sessionDays: 30,
    maxUploadBytes: 25 * 1024 * 1024,
    maxInputPixels: 80 * 1000 * 1000,
    maxOutputPixels: Number(env.LUMIO_MAX_PIXELS) || 36 * 1000 * 1000,
    maxImageSide: 8192,
    maxProjects: 200,
    userQuotaBytes: 200 * 1024 * 1024,
    cookieSecure: env.COOKIE_SECURE === "1",
    scryptN: 16384,
    aiWorker: env.LUMIO_AI === "1",
    pythonBin: env.LUMIO_PYTHON || "python3",
    // EDSR on CPU needs about 0.5 ms per input pixel (measured), so 300k pixels fits the 180 s limit with room to spare.
    aiModelDir: env.LUMIO_AI_MODELS || "",
    // "realesrgan" (default, needs torch) or "edsr" (needs opencv-contrib 4.x). Measured CPU speed: Real-ESRGAN compact about
    // 0.08 ms per input pixel, EDSR about 0.5 ms. The limits below keep a request inside its time limit on a 2 CPU machine.
    aiEngine: env.LUMIO_AI_ENGINE === "edsr" ? "edsr" : "realesrgan",
    aiMaxPixels: Number(env.LUMIO_AI_MAX_PIXELS) || (env.LUMIO_AI_ENGINE === "edsr" ? 300 * 1000 : 1000 * 1000),
    // Face restoration (GFPGAN) after the upscale. Needs GFPGANv1.4.pth in the models folder and facexlib. Off unless LUMIO_AI_FACES=1.
    aiFaces: env.LUMIO_AI_FACES === "1",
    aiTimeoutMs: Number(env.LUMIO_AI_TIMEOUT_MS) || 300 * 1000,
    workerConcurrency: Number(env.LUMIO_WORKERS) || 2,
    // Server video render (FFmpeg). Set LUMIO_VIDEO=0 to turn it off.
    videoWorker: env.LUMIO_VIDEO !== "0",
    ffmpegBin: env.LUMIO_FFMPEG || "ffmpeg",
    ffprobeBin: env.LUMIO_FFPROBE || "ffprobe",
    maxVideoBytes: 300 * 1024 * 1024,
    maxVideoSeconds: 300,
    maxVideoPixels: 34 * 1000 * 1000,
    // AI video enhancement (Real-ESRGAN on every frame). Measured on 2 CPUs this is seconds per frame, so the defaults are small;
    // on a GPU raise both. Longer or larger clips fall back to the normal render and say so in X-Lumio-Neural.
    videoAiMaxFrames: Number(env.LUMIO_VIDEO_AI_MAX_FRAMES) || 90,
    videoAiMaxShort: Number(env.LUMIO_VIDEO_AI_MAX_SHORT) || 360,
    videoConcurrency: 1,
    videoTimeoutMs: 20 * 60 * 1000
  }, overrides || {});
}

module.exports = { loadConfig };

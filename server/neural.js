"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { HttpError } = require("./util");

const AI_DIR = path.join(__dirname, "..", "ai");

/* Runs the optional Python AI workers (Real-ESRGAN, GFPGAN). One job at a time, because each one uses every CPU core
   (or the GPU). Extra jobs wait in a short queue; a full queue answers 429 instead of piling up. */
module.exports = function createNeural(cfg) {
  let chain = Promise.resolve(), waiting = 0;
  const MAX_WAITING = 4;

  function queued(fn) {
    if (waiting >= MAX_WAITING) return Promise.reject(new HttpError(429, "busy", "The AI worker is busy. Try again in a minute."));
    waiting++;
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p.finally(() => { waiting--; });
  }

  function py(args, timeout, what) {
    return new Promise((resolve, reject) => {
      execFile(cfg.pythonBin, args, { timeout, maxBuffer: 1 << 22 }, (err, so, se) => {
        if (!err) return resolve();
        reject(new HttpError(err.killed ? 504 : 502, err.killed ? "ai_timeout" : "ai_failed",
          err.killed ? what + " took too long. Use a smaller image." : String(se || err.message).split("\n").filter(Boolean).slice(-3).join(" ").slice(0, 300)));
      });
    });
  }

  const modelDir = () => cfg.aiModelDir || path.join(AI_DIR, "models");
  const tmp = (id, name) => path.join(os.tmpdir(), "lumio-" + id + "-" + name);

  /* Enlarge one PNG file by `scale` (any factor 1 to 8) and optionally restore faces. Returns the path of the result
     file and what was done. The caller deletes it. */
  function image(inFile, scale, { natural = 0, faces = 0 } = {}) {
    return queued(async () => {
      const id = crypto.randomBytes(8).toString("hex"), outFile = tmp(id, "out.png"), edsr = cfg.aiEngine === "edsr";
      const done = { faces: false };
      const args = edsr
        ? [path.join(AI_DIR, "upscale.py"), "--in", inFile, "--out", outFile, "--scale", String(scale <= 2 ? 2 : scale <= 3 ? 3 : 4)].concat(cfg.aiModelDir ? ["--model-dir", cfg.aiModelDir] : [])
        : [path.join(AI_DIR, "realesrgan.py"), "--in", inFile, "--out", outFile, "--outscale", String(scale), "--natural", String(natural)].concat(cfg.aiModelDir ? ["--model", path.join(cfg.aiModelDir, "realesr-general-x4v3.pth")] : []);
      try {
        await py(args, cfg.aiTimeoutMs, "Neural upscaling");
        if (faces > 0 && cfg.aiFaces && !edsr) {
          const faceOut = tmp(id, "faces.png");
          try {
            await py([path.join(AI_DIR, "gfpgan_face.py"), "--in", outFile, "--out", faceOut, "--weight", String(faces), "--model", path.join(modelDir(), "GFPGANv1.4.pth"), "--face-dir", path.join(modelDir(), "facexlib")], cfg.aiTimeoutMs, "Face restoration");
            fs.rmSync(outFile, { force: true });
            done.faces = true;
            return { file: faceOut, done };
          } catch (e) { fs.rmSync(faceOut, { force: true }); throw e; }
        }
        return { file: outFile, done };
      } catch (e) { fs.rmSync(outFile, { force: true }); throw e; }
    });
  }

  /* Enlarge a folder of PNG frames (video). The model loads once for the whole folder. */
  function frames(inDir, outDir, scale, { natural = 0.2, timeoutMs } = {}) {
    return queued(() => {
      const args = [path.join(AI_DIR, "realesrgan.py"), "--in-dir", inDir, "--out-dir", outDir, "--outscale", String(scale), "--natural", String(natural)]
        .concat(cfg.aiModelDir ? ["--model", path.join(cfg.aiModelDir, "realesr-general-x4v3.pth")] : []);
      return py(args, timeoutMs || cfg.videoTimeoutMs, "AI video enhancement");
    });
  }

  return { image, frames };
};

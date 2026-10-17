/* Real-ESRGAN (compact) in the browser, through ONNX Runtime Web. Used when there is no AI server: the page fetches the
   model from ai-web/ (about 27 MB, cached by the browser) and enlarges the photo 4x tile by tile on the graphics card
   (WebGPU) or, without one, on the CPU (WebAssembly, slow). Everything stays on the person's device. */
(function () {
  "use strict";
  var BASE = "ai-web/", MODEL = BASE + "realesr-general-x4v3.onnx", MAX_SRC_PX = 1.0e6, PAD = 16;
  var availP = null, ortP = null, sessP = null, provider = "";
  function abs(p) { return new URL(p, document.baseURI).href; }

  /* True when the model file is really there (a 404 page or a missing folder gives false, and the app uses its normal enhancer). */
  function available() {
    if (!availP) {
      availP = (location.protocol === "file:" || typeof fetch !== "function" || typeof WebAssembly !== "object") ? Promise.resolve(false) :
        fetch(abs(MODEL), { method: "HEAD" }).then(function (r) {
          var len = Number(r.headers.get("content-length")) || 0, type = r.headers.get("content-type") || "";
          return r.ok && !/text\/html/i.test(type) && (len === 0 || len > 1e6);
        }).catch(function () { return false; });
    }
    return availP;
  }
  function loadOrt() {
    if (window.ort) return Promise.resolve(window.ort);
    if (!ortP) ortP = new Promise(function (ok, bad) {
      var s = document.createElement("script"); s.src = abs(BASE + "ort.webgpu.min.js");
      s.onload = function () { ok(window.ort); }; s.onerror = function () { ortP = null; bad(new Error("Could not load the in-browser AI engine.")); };
      document.head.appendChild(s);
    });
    return ortP;
  }
  function makeSession(ort, eps) {
    return ort.InferenceSession.create(abs(MODEL), { executionProviders: eps, graphOptimizationLevel: "all" });
  }
  /* A small test run decides whether WebGPU really works on this device; if not, the CPU engine takes over. */
  function warm(ort, s) { return s.run({ x: new ort.Tensor("float32", new Float32Array(3 * 16 * 16), [1, 3, 16, 16]) }); }
  function session() {
    if (!sessP) sessP = loadOrt().then(function (ort) {
      ort.env.wasm.wasmPaths = abs(BASE);
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2)) : 1;
      var gpu = !!navigator.gpu;
      return (gpu ? makeSession(ort, ["webgpu"]).then(function (s) { return warm(ort, s).then(function () { provider = "webgpu"; return s; }); }) : Promise.reject(new Error("no webgpu")))
        .catch(function () { return makeSession(ort, ["wasm"]).then(function (s) { provider = "wasm"; return s; }); });
    }).catch(function (e) { sessP = null; throw e; });
    return sessP;
  }

  /* Enlarge a canvas 4x. onProgress gets 0..1. Resolves with a canvas of 4x the size. */
  function upscale4x(src, onProgress) {
    var w = src.width, h = src.height;
    if (w * h > MAX_SRC_PX * 1.02) return Promise.reject(new Error("too-large"));
    return Promise.all([loadOrt(), session()]).then(function (r) {
      var ort = r[0], s = r[1], T = provider === "webgpu" ? 192 : 96;
      var data = src.getContext("2d").getImageData(0, 0, w, h).data, out = new Uint8ClampedArray(w * 4 * h * 4 * 4), ow = w * 4;
      var tiles = [], ty, tx; for (ty = 0; ty < h; ty += T) for (tx = 0; tx < w; tx += T) tiles.push([tx, ty]);
      var i = 0;
      function next() {
        if (i >= tiles.length) return Promise.resolve();
        var x = tiles[i][0], y = tiles[i][1], x0 = Math.max(0, x - PAD), y0 = Math.max(0, y - PAD), x1 = Math.min(w, x + T + PAD), y1 = Math.min(h, y + T + PAD), tw = x1 - x0, th = y1 - y0;
        var inp = new Float32Array(3 * tw * th), plane = tw * th, yy, xx, p, q;
        for (yy = 0; yy < th; yy++) for (xx = 0; xx < tw; xx++) {
          p = ((y0 + yy) * w + x0 + xx) * 4; q = yy * tw + xx;
          inp[q] = data[p] / 255; inp[plane + q] = data[p + 1] / 255; inp[2 * plane + q] = data[p + 2] / 255;
        }
        return s.run({ x: new ort.Tensor("float32", inp, [1, 3, th, tw]) }).then(function (res) {
          var o = res.y.data, W = tw * 4, P = W * th * 4, cw = Math.min(T, w - x), ch = Math.min(T, h - y), ox0 = (x - x0) * 4, oy0 = (y - y0) * 4, v, a, b;
          for (b = 0; b < ch * 4; b++) for (a = 0; a < cw * 4; a++) {
            q = (oy0 + b) * W + ox0 + a; p = ((y * 4 + b) * ow + x * 4 + a) * 4;
            v = o[q]; out[p] = v < 0 ? 0 : v > 1 ? 255 : v * 255 + 0.5;
            v = o[P + q]; out[p + 1] = v < 0 ? 0 : v > 1 ? 255 : v * 255 + 0.5;
            v = o[2 * P + q]; out[p + 2] = v < 0 ? 0 : v > 1 ? 255 : v * 255 + 0.5;
            out[p + 3] = 255;
          }
          i++; if (onProgress) onProgress(i / tiles.length);
          return new Promise(function (ok) { setTimeout(ok, 0); }).then(next);
        });
      }
      return next().then(function () {
        var c = document.createElement("canvas"); c.width = w * 4; c.height = h * 4;
        c.getContext("2d").putImageData(new ImageData(out, w * 4, h * 4), 0, 0); return c;
      });
    });
  }
  window.LumioNeuralWeb = { available: available, upscale4x: upscale4x, maxSourcePixels: MAX_SRC_PX, provider: function () { return provider; } };
})();

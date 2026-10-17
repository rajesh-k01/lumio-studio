# ai-web

Files that let the page run the Real-ESRGAN "compact" network inside the browser (no server).

- `realesr-general-x4v3.onnx` is `ai/models/realesr-general-x4v3.pth` exported to ONNX with `ai/export_onnx.py` (BSD-3-Clause, Real-ESRGAN). The export matches PyTorch to about 1e-6.
- `ort.webgpu.min.js`, `ort-wasm-simd-threaded.jsep.mjs` and `ort-wasm-simd-threaded.jsep.wasm` are ONNX Runtime Web 1.20.1 (MIT, see `LICENSE-onnxruntime-web`). It uses the graphics card through WebGPU when the browser has it, and the CPU (WebAssembly) otherwise.

`public/js/neuralweb.js` loads them. If they are missing, the page quietly uses the normal enhancer.

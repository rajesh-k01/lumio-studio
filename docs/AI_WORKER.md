# Optional neural upscale workers

Lumio's built-in upscaler resamples and sharpens. For real repair of blur, noise and JPEG damage, the server can call a trained neural network. There are two engines, chosen with `LUMIO_AI_ENGINE`:

| Engine | Script | Best for | Needs |
|---|---|---|---|
| `realesrgan` (default) | `ai/realesrgan.py` | Damaged real-world photos: phone shots, compressed or noisy images. Adds realistic detail. | `torch`, `numpy`, `opencv-python-headless`, and `realesr-general-x4v3.pth` |
| `edsr` | `ai/upscale.py` | Clean images that only need to be bigger. Stays closest to the original pixels. | `opencv-contrib-python-headless` 4.x, and `EDSR_x2.pb` (and x3, x4) |

Turn it on with `LUMIO_AI=1`. Both were run end to end through the HTTP route (see `test/server.test.js`).

## Real-ESRGAN setup

```bash
python3 -m venv ai/venv && ai/venv/bin/pip install torch numpy opencv-python-headless
mkdir -p ai/models   # realesr-general-x4v3.pth from https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.2.5.0 (BSD-3-Clause)
LUMIO_AI=1 LUMIO_PYTHON=$PWD/ai/venv/bin/python npm start
```

`POST /api/ai/upscale?scale=1..8&natural=0..1`. `scale` is the final size factor, so it serves the HD, 2K, 4K and 8K choices directly (the network works at 4x, then the result is resized). `natural` blends in a plain upscale; the app uses 0.25 to soften the crunchy look GAN models can have. `ai/realesrgan.py --arch plus` loads the bigger `RealESRGAN_x4plus.pth`, which was tested on crops: slower (about 6 times) and only slightly more textured, so it is not the default.

### Measured on a real phone photo (717x1280, JPEG, noisy)

Same photo through Lumio's new pipeline and through Wink, compared by eye on face, fabric and ID-card crops:

- Lumio has more real detail than the original (bark, hair, skin texture) and cleaner skin.
- Wink looks more natural on the face. Lumio's result has hard dark outlines around the eyes and stronger contrast.
- Wink draws finer thread and embroidery lines on the fabric. Lumio's are cleaner but softer.
- Wink did not change the overall tone (mean brightness 53.1 before and after), it smoothed hard.
- Speed on 2 CPUs, no GPU: about 25 seconds for the full 0.92 MP photo at 2x; 4K output took about the same, because the network cost is set by the input size.

### Measured on clean downscaled photos (the same test as EDSR below)

| | Lanczos | Real-ESRGAN | Real-ESRGAN, `natural=0.25` |
|---|---|---|---|
| mean PSNR | 31.58 dB | 29.48 dB | 30.73 dB |

Real-ESRGAN scores **lower** than plain Lanczos here, and lower than EDSR (33.23 dB). That is expected: it is trained on damaged images and invents sharp texture, which a fidelity score punishes. Use it for damaged photos and use EDSR (or plain resizing) for clean ones.

Limits: inputs up to `LUMIO_AI_MAX_PIXELS` (default 1,000,000 for Real-ESRGAN, 300,000 for EDSR) and `LUMIO_AI_TIMEOUT_MS` (default 300,000). Faces are not treated specially: there is no face model, which is the main reason Wink looks more natural on portraits.

## What the user sees (photo)

In the Enhance panel the user picks a quality: Original, AI enhance, HD, 2K, 4K or 8K. There are no sliders. Picking one measures the photo, sets noise reduction, sharpness, clarity, dehaze, color balance, contrast and skin smoothing automatically, enhances the photo at once (AI on the server for signed-in VIP users when the worker is on, otherwise the built-in filters) and shows the result in the editor. "Preview and download" opens a window with Original, AI enhance, HD, 2K, 4K and 8K tabs: each tab enhances on demand (results are cached), shows Before and After side by side, and has a 100% view with dragging so the real pixels can be checked before downloading. The download is exactly the result that was previewed. Checked in real Chromium against the AI server: HD of a 717x1280 portrait took 43 s on 2 CPUs and downloaded correctly.

The panel also has a Look row (AI enhance, Auto fix, AI color, Portrait, Night view, Landscape, Cinematic, Old photo restore). A look and a quality are chosen independently, so all eight looks work with all five enhanced qualities (AI enhance, HD, 2K, 4K, 8K). The server runs the network and the fixes, then the natural finish, and applies the look last, so grain, vignette and colour grading survive the finish. Night view and Portrait brighten the photo by design, so they are not expected to match a reference that was not brightened.

## Where the AI runs in the app (photo and video)

When the AI worker is on and the user is signed in (VIP), every quality above uses the AI, because the server does the whole job:

1. `POST /api/process?target=...&neural=1&faces=0.7` runs Real-ESRGAN (at most 4x, the network's native factor), restores faces with GFPGAN on that result, resizes to the exact HD/2K/4K/8K size with Lanczos, then applies the same finishing filters as the preview (with noise reduction cut to 30%, so detail is not smoothed twice).
2. If it cannot run the AI step it still returns the normal result and says why in the `X-Lumio-Neural` header (`ai`, `ai+faces`, `too-large`, `not-needed`, `unavailable`). The app shows a message.
3. Videos: `POST /api/video/enhance?ai=1` extracts the frames (downscaled so the short side is at most `LUMIO_VIDEO_AI_MAX_SHORT`, default 360, with a light temporal denoise), enhances every frame with Real-ESRGAN in one worker process, and re-encodes with the original audio. Faces are not restored in video (too slow, and per-frame face rebuilding flickers). Clips longer than `LUMIO_VIDEO_AI_MAX_FRAMES` (default 90 frames) use the normal render.
4. Only one AI job runs at a time; up to 4 more wait, then the server answers 429.

Measured on 2 CPUs, one portrait (717x1280): HD 109 s, 2K 47 s, 4K 60 s, 8K 208 s (the HD figure includes loading the models for the first time). Video: 30 frames of 202x360 to 720x1284 took 130 s (about 4 s per frame). A GPU makes both far faster; set `LUMIO_PYTHON` to an environment with CUDA PyTorch and raise the limits.

Not measured: flicker in long or fast-moving video (only a 2 second pan was tested), several faces in one photo, and GPU speed.

## Face restoration (GFPGAN)

A general upscaler treats a face like any other texture, which is why Real-ESRGAN alone leaves hard outlines around the eyes. GFPGAN is trained on faces. After the upscale, `ai/gfpgan_face.py` finds each face, restores it and blends it back in. Turn it on with `LUMIO_AI_FACES=1`. The export dialog then shows "Restore faces", and the route accepts `faces=0..1` (the app uses 0.7).

```bash
ai/venv/bin/pip install facexlib        # face detector and face parser
# GFPGANv1.4.pth from https://github.com/TencentARC/GFPGAN/releases/tag/v1.3.0 into ai/models/
# facexlib downloads its detector and parser (about 190 MB) into ai/models/facexlib on first use, so run once with internet
LUMIO_AI=1 LUMIO_AI_FACES=1 LUMIO_PYTHON=$PWD/ai/venv/bin/python npm start
```

The two GFPGAN network files are vendored in `ai/gfpgan_arch/` (Apache-2.0, licence included). The `gfpgan` and `basicsr` packages are not needed: `basicsr` failed to build from PyPI here (a known version-parsing bug), and only those two files were required. Check the licence of every model you ship.

### Measured on the same phone photo as above

| | face brightness (L*) | skin smoothness (Laplacian variance, lower = smoother) |
|---|---|---|
| original | 35.9 | 129.9 |
| Real-ESRGAN only | 35.5 | 99.5 |
| Real-ESRGAN + faces | 35.7 | 61.8 |
| Wink | 35.7 | 54.7 |

By eye: the dark outlines around the eyes are gone and the eyes, brows and lips look natural. Skin is smooth with some texture left, slightly less airbrushed than Wink. Face colour and brightness stayed the same as the original (no lightening). Speed on 2 CPUs: about 35 seconds for the face step on the 1434x2560 image, and 40 to 56 seconds for the whole pipeline (upscale, faces, finishing) at HD, 2x and 4K.

### What it still does not do

- Fine non-face detail. On the embroidered dress, Wink redraws a crisper, more defined pattern. Lumio's result is cleaner than the original and faithful to it, but softer.
- GFPGAN rebuilds facial features, so at strong settings a face can look slightly different from the original. The app uses 0.7; lower it if likeness matters.
- Tested on one portrait (one face). Several faces, side faces, small faces and group photos were not tested.

# EDSR engine

**Status: tested.** The worker, and the server route that calls it, were run against the real `EDSR_x2.pb` model with OpenCV 4.10 (see Measured results). The x3 and x4 models use the same code path but were not run.

## Setup

```bash
python3 -m venv ai/venv-edsr && ai/venv-edsr/bin/pip install "opencv-contrib-python-headless>=4.5,<5" "numpy<2.3"
mkdir -p ai/models
# EDSR_x2.pb, EDSR_x3.pb, EDSR_x4.pb from https://github.com/Saafke/EDSR_Tensorflow/tree/master/models
LUMIO_AI=1 LUMIO_AI_ENGINE=edsr LUMIO_PYTHON=$PWD/ai/venv-edsr/bin/python npm start
```

**OpenCV 5.0 does not work.** In that release the `dnn_superres` module is empty, and the plain `cv2.dnn` importer cannot load EDSR's `DepthToSpace` layer. Both failures were reproduced. The script detects this and prints the install command instead of a stack trace.

## Measured results

Method: take a real photo, shrink it 2x with area averaging, enlarge it back, and compare with the original. Three photos bundled with scikit-image, OpenCV 4.10, CPU only.

| Image | Bicubic | Lanczos | EDSR x2 |
|---|---|---|---|
| astronaut | 30.63 dB, SSIM 0.943 | 30.82 dB, 0.944 | 33.04 dB, 0.957 |
| chelsea | 34.17 dB, 0.925 | 34.27 dB, 0.928 | 35.01 dB, 0.937 |
| coffee | 29.46 dB, 0.887 | 29.65 dB, 0.891 | 31.65 dB, 0.917 |
| mean PSNR | 31.42 | 31.58 | **33.23** |

That is about +1.65 dB over Lanczos. It is a clean-downscale test, so it shows what EDSR adds when the damage is only lost resolution. It says nothing about noisy or compressed input.

## Limits

- Speed: about 0.5 ms per input pixel on this 2 CPU machine (a 256x256 input took 32 s). The route therefore accepts inputs up to `LUMIO_AI_MAX_PIXELS` (default 300,000 pixels) and times out after 180 s. A GPU, or a smaller model, is needed for full-size photos.
- Large inputs are processed in overlapping 128 px tiles, so memory stays bounded. Tile seams were not inspected visually.
- It helps with softness. It does not repair faces or restore severe damage the way Remini or Wink are advertised to. To train a model for that, see `TRAINING.md`.

## Not built

Automatic captions from speech need a speech recognition model. Automatic face and body detection (so retouching needs no brush) would need landmark and segmentation models. Both are the natural next workers to add.

## Network choice (`LUMIO_AI_ARCH`)

| value | model | speed | note |
|---|---|---|---|
| `compact` (default) | realesr-general-x4v3 | fast | good on CPU |
| `plus` | RealESRGAN_x4plus | ~10x slower | no clear gain on the Wink test pair |
| `swinir` | SwinIR-L GAN (vendored, Apache-2.0) | ~40x slower | most natural, practically needs a GPU |

Put the matching weight file in `LUMIO_AI_MODEL_DIR` (`realesr-general-x4v3.pth`, `RealESRGAN_x4plus.pth`, `SwinIR_L_GAN.pth`).

## In-browser AI (no server)

`public/js/neuralweb.js` runs the compact model (`public/ai-web/realesr-general-x4v3.onnx`, exported with `ai/export_onnx.py`, parity 1.2e-6) through onnxruntime-web: WebGPU when present, otherwise WASM. It is used only when the server AI is off, for sources up to about 1 MP, and for HD or larger levels and "AI enhance". Measured: about 4 min for a 717x1280 photo on 2 CPU cores with WASM (no GPU tested). There is no GFPGAN face restore in the browser, so eyes look harsher than on the server path.
For GitHub Pages, `npm run pages` copies `ai-web/` next to the root `index.html`.

## Measured against one Wink pair (1080 short-side view)

| output | PSNR | SSIM | LapVar | Sat | L* |
|---|---|---|---|---|---|
| Wink | - | - | 273.4 | 88.5 | 135.5 |
| app, no AI | 27.65 | 0.791 | 249.5 | 88.1 | 135.3 |
| browser AI | 28.73 | 0.812 | 225.6 | 86.5 | 134.6 |
| server AI + faces | 28.44 | 0.795 | 273.7 | 86.1 | 135.0 |

Tone and colour already match. The remaining gap is generative fine detail (embroidery, eye texture) that statistics fitting on one pair cannot reproduce.

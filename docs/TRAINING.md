# Training a model for Remini, Wink or Gemini-class results

## The honest picture

Apps like Remini and Wink get their results from large neural networks trained on huge image sets with many GPUs. Gemini-style editing adds even larger generative models. Lumio's built-in "AI enhance" is not that: it measures the image (noise, softness, exposure, clipping, color cast, haze) and sets sliders. It is fast, runs anywhere and never invents detail, but it cannot rebuild a blurry face.

To get closer, you need a trained model. This folder gives you a working training pipeline that you can run on your own data. It was run end to end here, on a very small dataset, to prove the pipeline works. **It did not produce a model of Remini quality, and it cannot on this machine.** The sections below say what was measured and what it would take.

## What is in `ai/train/`

| File | Job |
|---|---|
| `degrade.py` | Damages clean images the way real uploads are damaged: blur, downscale (random method), sensor noise, JPEG. Each step is random, so the network learns to undo many kinds of damage. |
| `data.py` | Cuts random patches from a folder of clean images, flips and rotates them, degrades them on the fly into (low quality, clean) pairs. |
| `model.py` | `EDSRLite`: a small residual network with pixel-shuffle upscaling. Output is bicubic upscale plus a learned correction. |
| `train.py` | Training loop: L1 loss (optional VGG perceptual loss), Adam, cosine learning rate, validation PSNR. |
| `evaluate.py` | Compares the model with Lanczos on held-out images using the same degradation. PSNR and SSIM. |
| `export_onnx.py` | Exports to ONNX so it runs without PyTorch. |

## Run it

```bash
pip install torch opencv-python-headless scikit-image onnx onnxruntime
python3 ai/train/train.py    --data /path/to/clean_hr_images --val /path/to/heldout --scale 2 --steps 20000 --lr 1e-3 --out ai/train/runs/x2
python3 ai/train/evaluate.py --ckpt ai/train/runs/x2/model.pt --data /path/to/heldout --crop 0
python3 ai/train/export_onnx.py --ckpt ai/train/runs/x2/model.pt --out lumio_x2.onnx
```

## What was measured here

Setup: 7 training images and 1 held-out image (all bundled with scikit-image), CPU only, 2 cores.

| Run | Settings | Result |
|---|---|---|
| A | 1,200 steps, lr 2e-4 | Validation PSNR 26.83 dB against 26.91 dB for plain bicubic. **Worse.** The learned correction was tiny, so it was undertrained. |
| B | 3,000 steps, lr 1e-3 (about 17 minutes) | Validation patches: 27.05 dB against 26.93 dB for bicubic (+0.12 dB). |

Final check of run B on the whole held-out photo, one random degradation, Lanczos against the model:

| | PSNR | SSIM |
|---|---|---|
| Lanczos | 28.34 dB | 0.768 |
| Model B | 27.83 dB | 0.821 |

So: the model clearly cleans up structure (SSIM +0.05) but loses on PSNR. That is a single sample on one image, so treat it as noisy. With 8 images and 3,000 steps, the right conclusion is that **the pipeline works and the model is far too small a sample to judge**, not that this recipe fails or succeeds.

Other things that were verified: the ONNX file matches PyTorch to about 4e-7 on three different input sizes, and the neural upscale server route works with the real EDSR model (`AI_WORKER.md`).

## Fitting Lumio to a reference result ("natural finish")

You can teach Lumio the look of another tool's result for the same photo. `ai/train/fit_natural.js` takes Lumio's result without the finish stage (`before.png`) and the other tool's result (`reference.jpg`), and fits about 60 numbers: a shrinkage curve for each of four detail bands (weak, noise-like texture is calmed, real edges stay), a tone curve and one colour gain. `apply_natural.js` writes them into `public/js/engine.js`, where the `calm` and `natural` settings use them. It is not a neural network, and it matches statistics rather than pixels, so it cannot add detail the photo does not have.

```bash
node ai/train/fit_natural.js before.png reference.jpg params.json 0.3   # last 30% of rows held out
node ai/train/apply_natural.js params.json
node ai/train/eval_natural.js before.png finished.png
```

Fitted here on one portrait (Lumio's AI enhance HD result against a Wink result, `ai/train/natural_params.json`). The "before" picture is made the way the app makes it: the app measures a 512 px thumbnail to choose its automatic fixes, and an earlier fit that used different fixes had to be redone, because the finish then came out brighter and less saturated in the real UI. Measured against the Wink result (higher PSNR and SSIM is closer):

| | PSNR | SSIM | sharpness (Laplacian variance) | saturation |
|---|---|---|---|---|
| Lumio before the finish, fit rows | 24.1 | 0.694 | 579 | 93.2 |
| Lumio with the finish, fit rows | 27.1 | 0.753 | 216 | 81.9 |
| Wink, fit rows | - | - | 224 | 83.6 |
| Lumio before the finish, held-out rows | 25.6 | 0.690 | 374 | 104.9 |
| Lumio with the finish, held-out rows | 27.9 | 0.730 | 142 | 95.0 |
| Wink, held-out rows | - | - | 341 | 100.3 |

The colour gain (0.898) is fitted by matching the size of the colour differences RMS to RMS, because a least-squares slope reads low when the colour is noisy.

`enhance()` now runs in three phases: the automatic fixes, then the natural finish, then the look (filter, style, vignette, grain). The look comes last on purpose: a look such as Cinematic or Night view applied before the finish would have its contrast and grain "corrected" back towards the reference. Every look therefore works at every quality (AI enhance, HD, 2K, 4K, 8K) and keeps the same finished detail underneath.

The bottom 30% of the photo (ground, hem, tree base) was not used for fitting and improved too, so it is not just memorising those pixels. The honest limits: it is one photo and one reference; on the held-out rows Lumio ends up smoother than Wink (142 against 341); and neither the tuning nor the check has been repeated on other photos, so how well it carries over to other lighting, skin tones and subjects is not known. Refit with more pairs if you have them (`fit_natural.js` takes one pair; averaging parameters over several pairs is not built).

After the fit, all five qualities were run through the real server route and compared with Wink at a common 1080 px view (PSNR / SSIM / sharpness): AI enhance 28.4 / 0.801 / 224, HD 28.4 / 0.789 / 271, 2K 28.8 / 0.805 / 200, 4K 28.4 / 0.791 / 283, 8K 28.3 / 0.790 / 282 (Wink sharpness 273; plain enlargement 25.8 / 0.666 / 515).

## Not tested

The perceptual (VGG) loss, any GAN loss, LPIPS, face restoration, video models, and training on a GPU or on a real dataset. The code for the perceptual loss is in `train.py` but needs torchvision's VGG weights, which could not be downloaded here.

## The road to Remini-class quality

Rough order, from cheapest to hardest. Costs and times are rules of thumb from the public literature, not measurements from this project.

1. **Start from pretrained weights instead of training from scratch.** Real-ESRGAN (photos), GFPGAN and CodeFormer (faces), NAFNet (denoise and deblur), RIFE (frame interpolation) and Whisper (captions) are public. Check each licence before shipping. This gets you most of the visible quality for the cost of running them, and the ONNX route in `export_onnx.py` shows how a model plugs in without PyTorch.
2. **Data.** Thousands of clean, high-resolution images you have the right to use (for example DIV2K and Flickr2K for general photos, a licensed face set for portraits). More variety beats more of the same.
3. **Realistic damage.** Extend `degrade.py` with a second round of damage (blur, noise, JPEG applied twice), motion blur, and camera-style noise. Real-ESRGAN's results come mostly from this.
4. **Losses.** L1 gives accurate but soft output. Add a perceptual loss for texture, then a GAN loss for sharp, photographic detail. GAN training is unstable and needs care (a smaller GAN weight, a pretrained L1 model as the starting point).
5. **A bigger network** (RRDB blocks, as in ESRGAN) and **many more steps** (hundreds of thousands) on a GPU.
6. **Faces** need a dedicated model with face detection and alignment. A general upscaler will smear faces.
7. **Video** needs temporal consistency (otherwise detail flickers between frames), so use a video model or optical flow, and run it frame by frame on a GPU worker through the FFmpeg route.
8. **Measure like a product team.** PSNR and SSIM reward safe, soft results. Add LPIPS, a no-reference score such as NIQE, and most importantly a side-by-side test of real user photos, because that is the judge Remini and Wink are tuned against.
9. **Deploy.** Export to ONNX, run it in a worker behind `/api/ai/upscale` with a GPU, and keep the small-input cap (`LUMIO_AI_MAX_PIXELS`) until you have measured the speed.

## Fine-tuning towards Wink with paired photos (`ai/train/finetune_wink.py`, `eval_finetune.py`)

Pair = original photo + the same photo enhanced by Wink at 2x. The 4x network output is area-averaged to 2x (as in the app) and compared with Wink; only detail is learned (Wink's low frequencies are replaced by the original's, tone stays with the natural finish stage). A bottom band of the photo is held out; replay patches from other photos keep the model close to the original.

Result with ONE pair (CPU, 50 and 25 min runs), held-out band, detail target:

| model | PSNR | SSIM | LapVar (Wink 197) |
|---|---|---|---|
| original compact | 25.07 | 0.700 | 641 (too crunchy) |
| tuned, L1 + high-pass | 31.33 | 0.825 | 24 (too soft, blurry) |
| tuned, + texture-strength loss | 29.81 | 0.793 | 76 (calmer, still soft, no Wink-style embroidery) |

Numbers improve but the pictures do not look like Wink: L1-type losses average away fine detail. The tuned weights were NOT shipped. Reaching Wink's crisp embroidery needs many pairs plus an adversarial/perceptual loss (GPU). Run: `python3 finetune_wink.py --orig o.jpg --ref wink.jpg --weights realesr-general-x4v3.pth --out runs/x --replay-dir others/ --minutes 60 --l1w 0.3 --statw 8`.

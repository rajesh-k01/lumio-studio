#!/usr/bin/env python3
"""Compare a trained model with Lanczos on held-out images, using the same degradation for both.

  python3 ai/train/evaluate.py --ckpt ai/train/runs/x2/model.pt --data /path/to/heldout_hr
Prints PSNR and SSIM per image and the mean. LPIPS (perceptual score) needs the `lpips` package; see docs/TRAINING.md.
"""
import argparse
import random

import cv2
import numpy as np
import torch
from skimage.metrics import peak_signal_noise_ratio as psnr, structural_similarity as ssim

from data import list_images, to_tensor
from degrade import degrade
from model import EDSRLite


def load(ckpt):
    c = torch.load(ckpt, map_location="cpu")
    net = EDSRLite(c["scale"], c["nf"], c["blocks"])
    net.load_state_dict(c["state"]); net.eval()
    return net, c["scale"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--crop", type=int, default=256, help="centre crop (px) to keep evaluation quick, 0 = whole image")
    a = ap.parse_args()
    net, s = load(a.ckpt)
    rng = random.Random(7); np.random.seed(7)
    rows = []
    for f in list_images(a.data):
        hr = cv2.imread(f)
        if hr is None:
            continue
        if a.crop:
            h, w = hr.shape[:2]; c = min(a.crop, h, w); y, x = (h - c) // 2, (w - c) // 2; hr = hr[y:y + c, x:x + c]
        h, w = hr.shape[0] // s * s, hr.shape[1] // s * s; hr = hr[:h, :w]
        lr = degrade(hr, s, rng)
        base = cv2.resize(lr, (w, h), interpolation=cv2.INTER_LANCZOS4)
        with torch.no_grad():
            out = net(to_tensor(lr)[None])[0].clamp(0, 1).numpy().transpose(1, 2, 0)
        sr = cv2.cvtColor((out * 255).round().astype(np.uint8), cv2.COLOR_RGB2BGR)
        m = lambda im: (psnr(hr, im), ssim(hr, im, channel_axis=2))
        rows.append((f.split("/")[-1], m(base), m(sr)))
        print("%-22s lanczos %.2f dB / %.3f   model %.2f dB / %.3f" % (rows[-1][0], *rows[-1][1], *rows[-1][2]))
    if rows:
        print("MEAN  lanczos %.2f dB / %.3f   model %.2f dB / %.3f" % (np.mean([r[1][0] for r in rows]), np.mean([r[1][1] for r in rows]), np.mean([r[2][0] for r in rows]), np.mean([r[2][1] for r in rows])))


if __name__ == "__main__":
    main()

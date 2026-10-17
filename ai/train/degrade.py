"""Synthetic degradation: turns a clean image into the kind of low-quality input real users upload.

Order follows Real-ESRGAN's idea: blur -> downscale -> noise -> JPEG. Every step is randomised so the
network sees many different damage mixes and learns to undo them instead of memorising one.
"""
import random

import cv2
import numpy as np

INTERP = [cv2.INTER_AREA, cv2.INTER_LINEAR, cv2.INTER_CUBIC]


def degrade(hr, scale=2, rng=random, strength=1.0):
    """hr: uint8 BGR image (H, W, 3), H and W divisible by scale. Returns uint8 LR (H/scale, W/scale, 3)."""
    img = hr
    if rng.random() < 0.9:                                    # blur (lens / motion / focus)
        sigma = rng.uniform(0.2, 2.2) * strength
        img = cv2.GaussianBlur(img, (0, 0), sigma)
    h, w = img.shape[:2]
    img = cv2.resize(img, (w // scale, h // scale), interpolation=rng.choice(INTERP))
    if rng.random() < 0.8:                                    # sensor noise (gaussian, sometimes per-channel)
        sd = rng.uniform(1.0, 9.0) * strength
        noise = np.random.normal(0, sd, img.shape if rng.random() < 0.5 else img.shape[:2] + (1,))
        img = np.clip(img.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    if rng.random() < 0.8:                                    # JPEG compression artefacts
        q = int(rng.uniform(35, 95))
        ok, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])
        if ok:
            img = cv2.imdecode(enc, cv2.IMREAD_COLOR)
    return img

import glob
import os
import random

import cv2
import numpy as np
import torch
from torch.utils.data import Dataset

from degrade import degrade

EXT = ("*.png", "*.jpg", "*.jpeg", "*.webp", "*.bmp")


def list_images(folder):
    files = []
    for e in EXT:
        files += glob.glob(os.path.join(folder, "**", e), recursive=True)
    return sorted(files)


def to_tensor(bgr):
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    return torch.from_numpy(rgb.transpose(2, 0, 1).copy()).float() / 255.0


class PatchData(Dataset):
    """Random HR crops from a folder, degraded on the fly into (LR, HR) pairs."""

    def __init__(self, folder, scale=2, patch=96, length=2000, seed=None):
        self.files, self.scale, self.patch, self.length = list_images(folder), scale, patch, length
        if not self.files:
            raise SystemExit("No images found in " + folder)
        self.cache = {}
        self.rng = random.Random(seed)

    def __len__(self):
        return self.length

    def _img(self, path):
        if path not in self.cache:
            im = cv2.imread(path, cv2.IMREAD_COLOR)
            if im is None or min(im.shape[:2]) < self.patch:
                im = None
            self.cache[path] = im
        return self.cache[path]

    def __getitem__(self, i):
        for _ in range(10):
            im = self._img(self.rng.choice(self.files))
            if im is not None:
                break
        else:
            raise RuntimeError("no usable image (all smaller than the patch size)")
        p = self.patch
        y, x = self.rng.randint(0, im.shape[0] - p), self.rng.randint(0, im.shape[1] - p)
        hr = im[y:y + p, x:x + p]
        if self.rng.random() < 0.5:
            hr = hr[:, ::-1]
        if self.rng.random() < 0.5:
            hr = hr[::-1]
        hr = np.ascontiguousarray(hr)
        lr = degrade(hr, self.scale, self.rng)
        return to_tensor(lr), to_tensor(hr)

#!/usr/bin/env python3
"""Neural super resolution for Lumio using EDSR through OpenCV's dnn_superres module.

Usage:  python3 ai/upscale.py --in in.png --out out.png --scale 2

Setup (see docs/AI_WORKER.md):
  pip install "opencv-contrib-python-headless>=4.5,<5" "numpy<2.3"
  Put EDSR_x2.pb / EDSR_x3.pb / EDSR_x4.pb into ai/models/ (links are in docs/AI_WORKER.md).

Tested with opencv-contrib-python-headless 4.10.0 and EDSR_x2.pb. It does NOT work on OpenCV 5.0:
there the dnn_superres module is empty and the plain dnn importer cannot load EDSR's DepthToSpace layer.
Large images are processed in overlapping tiles so memory stays bounded.
"""
import argparse
import os
import sys


def upscale(cv2, np, sr, img, scale, tile=128, pad=8):
    h, w = img.shape[:2]
    out = np.zeros((h * scale, w * scale, 3), dtype=np.uint8)
    for y in range(0, h, tile):
        for x in range(0, w, tile):
            y0, x0 = max(0, y - pad), max(0, x - pad)
            y1, x1 = min(h, y + tile + pad), min(w, x + tile + pad)
            res = sr.upsample(img[y0:y1, x0:x1])
            cy0, cx0 = (y - y0) * scale, (x - x0) * scale
            ch, cw = min(tile, h - y) * scale, min(tile, w - x) * scale
            out[y * scale:y * scale + ch, x * scale:x * scale + cw] = res[cy0:cy0 + ch, cx0:cx0 + cw]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", dest="dst", required=True)
    ap.add_argument("--scale", type=int, default=2, choices=[2, 3, 4])
    ap.add_argument("--tile", type=int, default=128, help="tile size in input pixels")
    ap.add_argument("--model-dir", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "models"))
    a = ap.parse_args()

    try:
        import cv2
        import numpy as np
    except ImportError:
        sys.exit('OpenCV is not installed. Run: pip install "opencv-contrib-python-headless>=4.5,<5" "numpy<2.3"')
    if not hasattr(cv2, "dnn_superres") or not hasattr(cv2.dnn_superres, "DnnSuperResImpl_create"):
        sys.exit('This OpenCV (%s) has no usable dnn_superres. Install: pip install "opencv-contrib-python-headless>=4.5,<5"' % cv2.__version__)

    model = os.path.join(a.model_dir, "EDSR_x%d.pb" % a.scale)
    if not os.path.isfile(model):
        sys.exit("Model file missing: %s. See docs/AI_WORKER.md." % model)

    img = cv2.imread(a.src, cv2.IMREAD_COLOR)
    if img is None:
        sys.exit("Could not read the input image.")

    sr = cv2.dnn_superres.DnnSuperResImpl_create()
    sr.readModel(model)
    sr.setModel("edsr", a.scale)
    out = upscale(cv2, np, sr, img, a.scale, max(32, a.tile))
    if not cv2.imwrite(a.dst, out):
        sys.exit("Could not write the output image.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Score base vs fine-tuned network against the reference on the HELD-OUT band and on the trained area.
Both are run through the same path as the app (4x network, area-average to 2x). Tone is removed from the target the
same way as in training, so this measures detail only.
Usage: python3 eval_finetune.py --orig o.jpg --ref wink.jpg --base base.pth --tuned best.pth --out dir [--holdout-from 0.70]
"""
import argparse, os, sys
import cv2, numpy as np, torch, torch.nn as nn, torch.nn.functional as F
from skimage.metrics import structural_similarity as ssim, peak_signal_noise_ratio as psnr

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from realesrgan import build, run_tiled  # noqa: E402
from finetune_wink import blur, to_t, load_net  # noqa: E402


def to_img(t):
    return cv2.cvtColor((t[0].permute(1, 2, 0).clamp(0, 1).numpy() * 255).round().astype(np.uint8), cv2.COLOR_RGB2BGR)


def lapvar(im):
    return cv2.Laplacian(cv2.cvtColor(im, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var()


def main():
    ap = argparse.ArgumentParser()
    for k in ("orig", "ref", "base", "tuned", "out"):
        ap.add_argument("--" + k, required=True)
    ap.add_argument("--holdout-from", type=float, default=0.70)
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    o = cv2.imread(a.orig); H, W = o.shape[:2]
    ref = cv2.resize(cv2.imread(a.ref), (W * 2, H * 2), interpolation=cv2.INTER_AREA)
    O, R = to_t(o), to_t(ref)
    up = F.interpolate(O, scale_factor=2, mode="bicubic", align_corners=False)
    T = (R - blur(R, 6) + blur(up, 6)).clamp(0, 1)
    Ti, Ri = to_img(T), to_img(R)
    hy = int(H * a.holdout_from)
    regions = {"HELD-OUT band (never trained)": (2 * hy, 2 * H), "trained area": (0, 2 * hy - 40)}
    res = {}
    for name, path in (("base", a.base), ("tuned", a.tuned)):
        net = load_net(path).eval()
        out = F.avg_pool2d(run_tiled(torch, net, O, 192, 16), 2)
        im = to_img(out); res[name] = im; cv2.imwrite(os.path.join(a.out, name + "_2x.png"), im)
    print("%-30s %-6s %7s %7s %8s" % ("region (2x grid, vs detail target)", "model", "PSNR", "SSIM", "LapVar"))
    for rn, (y0, y1) in regions.items():
        t = Ti[y0:y1]
        print("%-30s %-6s %7s %7s %8.1f" % (rn, "WINK", "-", "-", lapvar(Ri[y0:y1])))
        for n in ("base", "tuned"):
            c = res[n][y0:y1]
            print("%-30s %-6s %7.2f %7.3f %8.1f" % (rn, n, psnr(t, c), ssim(t, c, channel_axis=2), lapvar(c)))
    # side-by-side crops of held-out dupatta embroidery
    def put(txt, im):
        im = im.copy(); cv2.rectangle(im, (0, 0), (im.shape[1], 24), (0, 0, 0), -1)
        cv2.putText(im, txt, (5, 17), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA); return im
    for tag, (y, x) in {"heldout_a": (2 * (hy + 40), 280), "heldout_b": (2 * (H - 220), 300)}.items():
        s = 260
        tiles = [put("WINK", Ri[y:y + s, x:x + s]), put("original model", res["base"][y:y + s, x:x + s]), put("fine-tuned", res["tuned"][y:y + s, x:x + s])]
        tiles = [cv2.resize(t, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC) for t in tiles]
        cv2.imwrite(os.path.join(a.out, "cmp_%s.jpg" % tag), np.hstack(tiles), [cv2.IMWRITE_JPEG_QUALITY, 92])


if __name__ == "__main__":
    main()

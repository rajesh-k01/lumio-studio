#!/usr/bin/env python3
"""Train EDSRLite on your own folder of clean, high-resolution images.

  python3 ai/train/train.py --data /path/to/hr_images --scale 2 --steps 20000 --out ai/train/runs/x2

Loss is L1 (sharper than L2). Add --perceptual to also use a VGG feature loss when torchvision weights
are available. A GAN loss (what Real-ESRGAN adds for photographic texture) is described in docs/TRAINING.md.
"""
import argparse
import math
import os
import time

import torch
from torch.utils.data import DataLoader

from data import PatchData
from model import EDSRLite


def psnr(a, b):
    mse = torch.mean((a.clamp(0, 1) - b) ** 2, dim=(1, 2, 3)).clamp_min(1e-10)
    return (10 * torch.log10(1.0 / mse)).mean().item()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--val", help="folder of held-out HR images (defaults to a seeded slice of --data patches)")
    ap.add_argument("--scale", type=int, default=2, choices=[2, 3, 4])
    ap.add_argument("--steps", type=int, default=2000)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--patch", type=int, default=96, help="HR patch size, divisible by scale")
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--nf", type=int, default=48)
    ap.add_argument("--blocks", type=int, default=8)
    ap.add_argument("--perceptual", action="store_true")
    ap.add_argument("--out", default="ai/train/runs/x2")
    ap.add_argument("--workers", type=int, default=0)
    a = ap.parse_args()
    if a.patch % a.scale:
        raise SystemExit("--patch must be divisible by --scale")
    os.makedirs(a.out, exist_ok=True)
    torch.manual_seed(0)

    train = DataLoader(PatchData(a.data, a.scale, a.patch, length=a.steps * a.batch), batch_size=a.batch, num_workers=a.workers, shuffle=False)
    val = PatchData(a.val or a.data, a.scale, a.patch, length=64, seed=1234)
    vx, vy = zip(*[val[i] for i in range(len(val))])
    vx, vy = torch.stack(vx), torch.stack(vy)

    net = EDSRLite(a.scale, a.nf, a.blocks)
    opt = torch.optim.Adam(net.parameters(), lr=a.lr)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: 0.5 * (1 + math.cos(math.pi * min(1.0, s / max(1, a.steps)))) * 0.95 + 0.05)

    vgg = None
    if a.perceptual:
        try:
            from torchvision.models import vgg19, VGG19_Weights
            vgg = vgg19(weights=VGG19_Weights.DEFAULT).features[:35].eval()
            for p in vgg.parameters():
                p.requires_grad = False
        except Exception as e:                                  # weights need a download; fall back to L1 only
            print("perceptual loss unavailable (%s), using L1 only" % e)

    bicubic = torch.nn.functional.interpolate(vx, scale_factor=a.scale, mode="bicubic", align_corners=False)
    print("validation PSNR of plain bicubic: %.2f dB" % psnr(bicubic, vy))
    t0 = time.time()
    for step, (x, y) in enumerate(train, 1):
        out = net(x)
        loss = torch.nn.functional.l1_loss(out, y)
        if vgg is not None:
            loss = loss + 0.05 * torch.nn.functional.l1_loss(vgg(out.clamp(0, 1)), vgg(y))
        opt.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0); opt.step(); sched.step()
        if step % max(1, a.steps // 10) == 0 or step == a.steps:
            net.eval()
            with torch.no_grad():
                p = psnr(net(vx), vy)
            net.train()
            print("step %5d  loss %.4f  val PSNR %.2f dB  (%.0fs)" % (step, loss.item(), p, time.time() - t0), flush=True)
    torch.save({"state": net.state_dict(), "scale": a.scale, "nf": a.nf, "blocks": a.blocks}, os.path.join(a.out, "model.pt"))
    print("saved", os.path.join(a.out, "model.pt"))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Real-ESRGAN (general x4 v3, the small "compact" network) for Lumio.

This is a trained neural network. It repairs blur, noise and JPEG damage and adds realistic detail,
which classical filters cannot do. Optional bigger networks: --arch plus (RealESRGAN_x4plus.pth) and --arch swinir (SwinIR_L_GAN.pth, Apache-2.0, from
https://github.com/JingyunLiang/SwinIR/releases/tag/v0.0, file 003_realSR_BSRGAN_DFOWMFC_s64w8_SwinIR-L_x4_GAN.pth).
Weights: realesr-general-x4v3.pth (BSD-3-Clause licence,
https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.2.5.0), put it in ai/models/.

Usage:  python3 ai/realesrgan.py --in in.jpg --out out.png --outscale 2
        --outscale is the final size factor (1 to 8). The network works at 4x, then the result is
        resized to the requested factor with area averaging, which also reduces any artefacts.
        --natural 0..1 blends in a plain (non-neural) upscale. It softens the "crunchy" look and halos that GAN models can
        leave around eyes and hair. 0 = full neural result; 0.25 to 0.35 looks more natural on portraits.
Needs: pip install torch numpy opencv-python-headless
"""
import argparse
import os
import sys


def build(torch, nn, F):
    class SRVGGNetCompact(nn.Module):
        def __init__(self, num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=32, upscale=4):
            super().__init__()
            self.upscale = upscale
            self.body = nn.ModuleList()
            self.body.append(nn.Conv2d(num_in_ch, num_feat, 3, 1, 1))
            self.body.append(nn.PReLU(num_parameters=num_feat))
            for _ in range(num_conv):
                self.body.append(nn.Conv2d(num_feat, num_feat, 3, 1, 1))
                self.body.append(nn.PReLU(num_parameters=num_feat))
            self.body.append(nn.Conv2d(num_feat, num_out_ch * upscale * upscale, 3, 1, 1))
            self.upsampler = nn.PixelShuffle(upscale)

        def forward(self, x):
            out = x
            for layer in self.body:
                out = layer(out)
            out = self.upsampler(out)
            return out + F.interpolate(x, scale_factor=self.upscale, mode="nearest")
    return SRVGGNetCompact


def build_plus(torch, nn, F):
    """RealESRGAN_x4plus: RRDBNet with 23 blocks. Bigger and slower than the compact model, keeps more texture."""
    class RDB(nn.Module):
        def __init__(self, nf=64, gc=32):
            super().__init__()
            self.conv1 = nn.Conv2d(nf, gc, 3, 1, 1)
            self.conv2 = nn.Conv2d(nf + gc, gc, 3, 1, 1)
            self.conv3 = nn.Conv2d(nf + 2 * gc, gc, 3, 1, 1)
            self.conv4 = nn.Conv2d(nf + 3 * gc, gc, 3, 1, 1)
            self.conv5 = nn.Conv2d(nf + 4 * gc, nf, 3, 1, 1)

        def forward(self, x):
            lr = lambda t: F.leaky_relu(t, 0.2, inplace=True)
            x1 = lr(self.conv1(x))
            x2 = lr(self.conv2(torch.cat((x, x1), 1)))
            x3 = lr(self.conv3(torch.cat((x, x1, x2), 1)))
            x4 = lr(self.conv4(torch.cat((x, x1, x2, x3), 1)))
            return self.conv5(torch.cat((x, x1, x2, x3, x4), 1)) * 0.2 + x

    class RRDB(nn.Module):
        def __init__(self, nf=64, gc=32):
            super().__init__()
            self.rdb1, self.rdb2, self.rdb3 = RDB(nf, gc), RDB(nf, gc), RDB(nf, gc)

        def forward(self, x):
            return self.rdb3(self.rdb2(self.rdb1(x))) * 0.2 + x

    class RRDBNet(nn.Module):
        def __init__(self, nf=64, nb=23, gc=32):
            super().__init__()
            self.conv_first = nn.Conv2d(3, nf, 3, 1, 1)
            self.body = nn.Sequential(*[RRDB(nf, gc) for _ in range(nb)])
            self.conv_body = nn.Conv2d(nf, nf, 3, 1, 1)
            self.conv_up1 = nn.Conv2d(nf, nf, 3, 1, 1)
            self.conv_up2 = nn.Conv2d(nf, nf, 3, 1, 1)
            self.conv_hr = nn.Conv2d(nf, nf, 3, 1, 1)
            self.conv_last = nn.Conv2d(nf, 3, 3, 1, 1)

        def forward(self, x):
            feat = self.conv_first(x)
            feat = feat + self.conv_body(self.body(feat))
            feat = F.leaky_relu(self.conv_up1(F.interpolate(feat, scale_factor=2, mode="nearest")), 0.2, inplace=True)
            feat = F.leaky_relu(self.conv_up2(F.interpolate(feat, scale_factor=2, mode="nearest")), 0.2, inplace=True)
            return self.conv_last(F.leaky_relu(self.conv_hr(feat), 0.2, inplace=True))
    return RRDBNet


def run_tiled(torch, net, img, tile, pad, scale=4):
    """img: float32 tensor (1, 3, H, W) in 0..1. Returns (1, 3, H*scale, W*scale)."""
    _, _, h, w = img.shape
    out = torch.zeros((1, 3, h * scale, w * scale))
    for y in range(0, h, tile):
        for x in range(0, w, tile):
            y0, x0, y1, x1 = max(0, y - pad), max(0, x - pad), min(h, y + tile + pad), min(w, x + tile + pad)
            part = img[:, :, y0:y1, x0:x1]
            ph, pw = (-part.shape[2]) % 8, (-part.shape[3]) % 8
            if ph or pw:
                part = torch.nn.functional.pad(part, (0, pw, 0, ph), mode="reflect")
            with torch.no_grad():
                res = net(part)
            if ph or pw:
                res = res[:, :, :res.shape[2] - ph * scale, :res.shape[3] - pw * scale]
            ty, tx = (y - y0) * scale, (x - x0) * scale
            th, tw = min(tile, h - y) * scale, min(tile, w - x) * scale
            out[:, :, y * scale:y * scale + th, x * scale:x * scale + tw] = res[:, :, ty:ty + th, tx:tx + tw]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", default="")
    ap.add_argument("--out", dest="dst", default="")
    ap.add_argument("--in-dir", dest="src_dir", default="", help="batch mode: enhance every .png in this folder (model loads once, used for video frames)")
    ap.add_argument("--out-dir", dest="dst_dir", default="")
    ap.add_argument("--outscale", type=float, default=2.0)
    ap.add_argument("--natural", type=float, default=0.0, help="0 = full neural result, 1 = plain upscale")
    ap.add_argument("--tile", type=int, default=256)
    ap.add_argument("--arch", choices=["compact", "plus", "swinir"], default="compact", help="compact = realesr-general-x4v3 (fast), plus = RealESRGAN_x4plus (about 10x slower, more texture), swinir = SwinIR-L GAN (about 40x slower, the most natural faces; wants a GPU)")
    ap.add_argument("--model", default="")
    ap.add_argument("--threads", type=int, default=0)
    a = ap.parse_args()
    try:
        import cv2
        import numpy as np
        import torch
        import torch.nn as nn
        import torch.nn.functional as F
    except ImportError:
        sys.exit("Needs torch, numpy and opencv: pip install torch numpy opencv-python-headless")
    if not a.model:
        a.model = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", {"compact": "realesr-general-x4v3.pth", "plus": "RealESRGAN_x4plus.pth", "swinir": "SwinIR_L_GAN.pth"}[a.arch])
    if not os.path.isfile(a.model):
        sys.exit("Model file missing: %s (see docs/AI_WORKER.md)" % a.model)
    if a.threads:
        torch.set_num_threads(a.threads)
    batch = bool(a.src_dir)
    if batch and not a.dst_dir or not batch and not (a.src and a.dst):
        sys.exit("Give --in and --out, or --in-dir and --out-dir.")
    if a.arch == "swinir":
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from swinir.network_swinir import SwinIR
        net = SwinIR(upscale=4, in_chans=3, img_size=64, window_size=8, img_range=1.0, depths=[6] * 9, embed_dim=240, num_heads=[8] * 9,
                     mlp_ratio=2, upsampler="nearest+conv", resi_connection="3conv")
    else:
        net = (build if a.arch == "compact" else build_plus)(torch, nn, F)()
    state = torch.load(a.model, map_location="cpu", weights_only=True)
    for key in ("params_ema", "params"):
        if key in state:
            state = state[key]
            break
    net.load_state_dict(state, strict=True)
    net.eval()

    def one(src, dst):
        bgr = cv2.imread(src, cv2.IMREAD_COLOR)
        if bgr is None:
            sys.exit("Could not read the input image: %s" % src)
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        t = torch.from_numpy(rgb.transpose(2, 0, 1)).float().div(255).unsqueeze(0)
        out = run_tiled(torch, net, t, max(64, a.tile), 12)[0].clamp(0, 1).mul(255).round().byte().numpy().transpose(1, 2, 0)
        h, w = bgr.shape[:2]
        tw, th = max(1, round(w * a.outscale)), max(1, round(h * a.outscale))
        res = cv2.resize(out, (tw, th), interpolation=cv2.INTER_AREA if a.outscale < 4 else cv2.INTER_LANCZOS4)
        if a.natural > 0:
            plain = cv2.resize(rgb, (tw, th), interpolation=cv2.INTER_LANCZOS4)
            res = cv2.addWeighted(res, 1 - min(1.0, a.natural), plain, min(1.0, a.natural), 0)
        if not cv2.imwrite(dst, cv2.cvtColor(res, cv2.COLOR_RGB2BGR)):
            sys.exit("Could not write the output image.")

    if batch:
        os.makedirs(a.dst_dir, exist_ok=True)
        names = sorted(n for n in os.listdir(a.src_dir) if n.lower().endswith(".png"))
        for i, n in enumerate(names):
            one(os.path.join(a.src_dir, n), os.path.join(a.dst_dir, n))
            print("frame %d/%d" % (i + 1, len(names)), file=sys.stderr, flush=True)
    else:
        one(a.src, a.dst)


if __name__ == "__main__":
    main()

import torch
import torch.nn as nn
import torch.nn.functional as F


class ResBlock(nn.Module):
    def __init__(self, nf, res_scale=0.1):
        super().__init__()
        self.body = nn.Sequential(nn.Conv2d(nf, nf, 3, padding=1), nn.ReLU(inplace=True), nn.Conv2d(nf, nf, 3, padding=1))
        self.res_scale = res_scale

    def forward(self, x):
        return x + self.body(x) * self.res_scale


class EDSRLite(nn.Module):
    """Small EDSR-style super-resolution network.

    The output is bicubic(x) + learned residual, so the network only has to learn the missing detail
    (and the denoise / deblock correction), which trains fast and never does worse than bicubic by much.
    """

    def __init__(self, scale=2, nf=48, blocks=8):
        super().__init__()
        self.scale = scale
        self.head = nn.Conv2d(3, nf, 3, padding=1)
        self.body = nn.Sequential(*[ResBlock(nf) for _ in range(blocks)], nn.Conv2d(nf, nf, 3, padding=1))
        self.up = nn.Sequential(nn.Conv2d(nf, nf * scale * scale, 3, padding=1), nn.PixelShuffle(scale))
        self.tail = nn.Conv2d(nf, 3, 3, padding=1)

    def forward(self, x):
        base = F.interpolate(x, scale_factor=self.scale, mode="bicubic", align_corners=False)
        f = self.head(x)
        f = f + self.body(f)
        return base + self.tail(self.up(f))

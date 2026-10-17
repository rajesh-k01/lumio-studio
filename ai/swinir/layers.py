import torch, torch.nn as nn, math, collections.abc
def to_2tuple(x): return x if isinstance(x, collections.abc.Iterable) and not isinstance(x, str) else (x, x)
def trunc_normal_(t, mean=0., std=1., a=-2., b=2.):
    with torch.no_grad(): t.normal_(mean, std).clamp_(a*std+mean, b*std+mean); return t
class DropPath(nn.Module):
    def __init__(self, drop_prob=0.): super().__init__(); self.p = drop_prob
    def forward(self, x):
        if self.p == 0. or not self.training: return x
        keep = 1 - self.p; shape = (x.shape[0],) + (1,) * (x.ndim - 1)
        return x * (torch.rand(shape, dtype=x.dtype, device=x.device).floor_() + keep).div(keep) * 1.0

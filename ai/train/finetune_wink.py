#!/usr/bin/env python3
"""Fine-tune the compact Real-ESRGAN network towards the detail of a reference enhancer (Wink) using paired photos.

Pair = (original photo, the same photo enhanced by the reference at 2x size).
The network works at 4x. During training its output is area-averaged by 2 (exactly what the app does when it
resizes to a 2x result) and compared with the reference. Colour/tone is NOT learned here: the reference target gets
the low frequencies of the original, so only detail is learned and the app's natural finish stage keeps handling tone.

Over-fitting guards (a single pair is tiny):
  * a band of the photo is held out and never trained on; the best checkpoint is picked by that band only
  * "replay" patches from other photos are kept close to the original network (distillation)
  * small learning rate, short run

Usage: python3 finetune_wink.py --orig o.jpg --ref wink.jpg --weights realesr-general-x4v3.pth --out out_dir \
           [--replay-dir dir_of_other_photos] [--minutes 60]
"""
import argparse, glob, json, os, random, sys, time
import cv2, numpy as np, torch, torch.nn as nn, torch.nn.functional as F

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from realesrgan import build  # noqa: E402

torch.set_num_threads(max(1, os.cpu_count() or 1))


def gauss_kernel(sigma, k=None):
    k = k or int(sigma * 4) * 2 + 1
    ax = torch.arange(k) - k // 2
    g = torch.exp(-(ax.float() ** 2) / (2 * sigma ** 2)); g /= g.sum()
    return g


def blur(x, sigma):
    g = gauss_kernel(sigma); k = len(g); c = x.shape[1]
    kh = g.view(1, 1, 1, k).repeat(c, 1, 1, 1); kv = g.view(1, 1, k, 1).repeat(c, 1, 1, 1)
    x = F.conv2d(F.pad(x, (k // 2, k // 2, 0, 0), mode="reflect"), kh, groups=c)
    return F.conv2d(F.pad(x, (0, 0, k // 2, k // 2), mode="reflect"), kv, groups=c)


def hp(x):
    return x - blur(x, 1.5)


def energy(x):
    """local high-frequency strength per 8x8 block (matches texture strength, not exact pixels)"""
    h = hp(x)
    return (F.avg_pool2d(h * h, 8) + 1e-6).sqrt()


def to_t(bgr):
    return torch.from_numpy(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)).permute(2, 0, 1).float().div(255)[None]


def load_net(path):
    net = build(torch, nn, F)()
    st = torch.load(path, map_location="cpu", weights_only=True)
    for key in ("params_ema", "params"):
        if key in st:
            st = st[key]; break
    net.load_state_dict(st, strict=True)
    return net


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--orig", required=True); ap.add_argument("--ref", required=True)
    ap.add_argument("--weights", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--replay-dir"); ap.add_argument("--minutes", type=float, default=60)
    ap.add_argument("--lr", type=float, default=1e-4); ap.add_argument("--patch", type=int, default=40)
    ap.add_argument("--batch", type=int, default=6); ap.add_argument("--holdout-from", type=float, default=0.70,
                    help="fraction of image height below which rows are never trained on")
    ap.add_argument("--l1w", type=float, default=1.0); ap.add_argument("--statw", type=float, default=0.0)
    ap.add_argument("--eval-every", type=int, default=50); ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    random.seed(a.seed); torch.manual_seed(a.seed); os.makedirs(a.out, exist_ok=True)

    o = cv2.imread(a.orig); H, W = o.shape[:2]
    ref = cv2.resize(cv2.imread(a.ref), (W * 2, H * 2), interpolation=cv2.INTER_AREA)
    O = to_t(o); R = to_t(ref)
    # detail-only target: reference high frequencies + original low frequencies
    up = F.interpolate(O, scale_factor=2, mode="bicubic", align_corners=False)
    T = (R - blur(R, 6) + blur(up, 6)).clamp(0, 1)

    base = load_net(a.weights).eval()
    net = load_net(a.weights).train()
    for p in base.parameters():
        p.requires_grad_(False)

    replay = []
    if a.replay_dir:
        for f in sorted(glob.glob(os.path.join(a.replay_dir, "*.jpg")))[:14]:
            im = cv2.imread(f)
            if im is None: continue
            s = 720 / min(im.shape[:2]); im = cv2.resize(im, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
            replay.append(to_t(im))

    hy = int(H * a.holdout_from)
    P = a.patch
    # held-out eval patches (LR coordinates), inside the held-out band
    ev = [(hy + 20, 140), (hy + 20, 330), (H - 150, 150), (H - 150, 320)]
    ev = [(min(y, H - 128), min(x, W - 128)) for y, x in ev]

    def evaluate(model):
        tot = {"l1": 0, "hp": 0, "tex": 0}
        with torch.no_grad():
            for y, x in ev:
                lr = O[:, :, y:y + 128, x:x + 128]
                out = F.avg_pool2d(model(lr), 2)
                tg = T[:, :, 2 * y:2 * y + 256, 2 * x:2 * x + 256]
                tot["l1"] += (out - tg).abs().mean().item() / len(ev)
                tot["hp"] += (hp(out) - hp(tg)).abs().mean().item() / len(ev)
                tot["tex"] += float(torch.log(energy(out).pow(2).mean() / energy(tg).pow(2).mean()).abs()) / len(ev)
        return tot

    def score(d):
        return d["l1"] + 4 * d["hp"] + (0.04 * d["tex"] if a.statw > 0 else 0)

    log = open(os.path.join(a.out, "train.log"), "w")
    def say(s):
        print(s, flush=True); log.write(s + "\n"); log.flush()

    e0 = evaluate(base); best = score(e0); say("iter 0 heldout %s score %.5f (base)" % (json.dumps(e0), best))
    torch.save(net.state_dict(), os.path.join(a.out, "best.pth"))
    opt = torch.optim.Adam(net.parameters(), lr=a.lr)

    # candidate train positions (LR coords), kept clear of the held-out band
    def sample():
        cands = []
        for _ in range(6):
            y = random.randint(0, hy - 20 - P); x = random.randint(0, W - P)
            t = T[:, :, 2 * y:2 * y + 2 * P, 2 * x:2 * x + 2 * P]
            cands.append((hp(t).abs().mean().item(), y, x))
        cands.sort(reverse=True)
        c = cands[0] if random.random() < 0.5 else random.choice(cands)
        return c[1], c[2]

    t0 = time.time(); it = 0; best_it = 0; hist = []
    while time.time() - t0 < a.minutes * 60:
        it += 1
        xs, ts = [], []
        for _ in range(a.batch):
            y, x = sample()
            lr = O[:, :, y:y + P, x:x + P]; tg = T[:, :, 2 * y:2 * y + 2 * P, 2 * x:2 * x + 2 * P]
            if random.random() < 0.5: lr, tg = lr.flip(3), tg.flip(3)
            if random.random() < 0.5: lr, tg = lr.flip(2), tg.flip(2)
            xs.append(lr); ts.append(tg)
        out = F.avg_pool2d(net(torch.cat(xs)), 2); tg = torch.cat(ts)
        loss = a.l1w * (out - tg).abs().mean() + 2.0 * (hp(out) - hp(tg)).abs().mean() + a.statw * (energy(out) - energy(tg)).abs().mean()
        if replay:
            r = random.choice(replay); _, _, rh, rw = r.shape
            ry, rx = random.randint(0, rh - P), random.randint(0, rw - P)
            rl = r[:, :, ry:ry + P, rx:rx + P]
            with torch.no_grad():
                bt = base(rl)
            loss = loss + 0.5 * (net(rl) - bt).abs().mean()
        opt.zero_grad(); loss.backward(); opt.step(); hist.append(loss.item())
        if it % a.eval_every == 0:
            net.eval(); e = evaluate(net); net.train(); s = score(e)
            say("iter %d (%.0fs) train %.5f heldout %s score %.5f%s" % (it, time.time() - t0, np.mean(hist[-a.eval_every:]), json.dumps(e), s, "  *best" if s < best else ""))
            if s < best:
                best, best_it = s, it; torch.save(net.state_dict(), os.path.join(a.out, "best.pth"))
    torch.save(net.state_dict(), os.path.join(a.out, "last.pth"))
    say("done: %d iters, best held-out score %.5f at iter %d (base %.5f)" % (it, best, best_it, score(e0)))


if __name__ == "__main__":
    main()

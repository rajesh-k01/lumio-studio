#!/usr/bin/env python3
"""Face restoration for Lumio with GFPGAN v1.4.

A general upscaler treats a face like any other texture. GFPGAN is trained on faces, so it rebuilds eyes, brows,
lips and skin in a natural way. This script finds every face in an image, restores each one and blends it back
in. Run it AFTER the Real-ESRGAN pass (ai/realesrgan.py), on the enlarged image.

Usage:  python3 ai/gfpgan_face.py --in big.png --out restored.png --weight 0.5
  --weight 0..1  how strongly the restored face replaces the original (0.5 is a good start, 1 is the full GFPGAN look).
Needs: pip install torch numpy opencv-python-headless facexlib
Files: GFPGANv1.4.pth in ai/models/ (https://github.com/TencentARC/GFPGAN/releases/tag/v1.3.0).
       facexlib downloads its small face detector and face parser on first use, so the first run needs internet.
GFPGAN is licensed Apache-2.0, see ai/gfpgan_arch/LICENSE-GFPGAN.txt. Check the licence of each model you ship.
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", dest="dst", required=True)
    ap.add_argument("--weight", type=float, default=0.5)
    ap.add_argument("--only-center-face", action="store_true")
    ap.add_argument("--model", default=os.path.join(HERE, "models", "GFPGANv1.4.pth"))
    ap.add_argument("--face-dir", default=os.path.join(HERE, "models", "facexlib"), help="folder for the face detector and parser weights")
    ap.add_argument("--threads", type=int, default=0)
    a = ap.parse_args()
    try:
        import cv2
        import numpy as np
        import torch
        from torchvision.transforms.functional import normalize
        from facexlib.utils.face_restoration_helper import FaceRestoreHelper
    except ImportError as e:
        sys.exit("Needs torch, numpy, opencv and facexlib (%s). pip install torch numpy opencv-python-headless facexlib" % e)
    sys.path.insert(0, HERE)
    from gfpgan_arch.gfpganv1_clean_arch import GFPGANv1Clean

    if not os.path.isfile(a.model):
        sys.exit("Model file missing: %s (see docs/AI_WORKER.md)" % a.model)
    if a.threads:
        torch.set_num_threads(a.threads)
    img = cv2.imread(a.src, cv2.IMREAD_COLOR)
    if img is None:
        sys.exit("Could not read the input image.")
    os.makedirs(a.face_dir, exist_ok=True)

    net = GFPGANv1Clean(out_size=512, num_style_feat=512, channel_multiplier=2, decoder_load_path=None, fix_decoder=False,
                        num_mlp=8, input_is_latent=True, different_w=True, narrow=1, sft_half=True)
    state = torch.load(a.model, map_location="cpu", weights_only=True)
    net.load_state_dict(state["params_ema"] if "params_ema" in state else state, strict=True)
    net.eval()

    helper = FaceRestoreHelper(1, face_size=512, crop_ratio=(1, 1), det_model="retinaface_resnet50", save_ext="png",
                               use_parse=True, device="cpu", model_rootpath=a.face_dir)
    helper.clean_all()
    helper.read_image(img)
    n = helper.get_face_landmarks_5(only_center_face=a.only_center_face, eye_dist_threshold=5)
    print("faces found: %d" % n, file=sys.stderr)
    if n == 0:
        cv2.imwrite(a.dst, img)
        return
    helper.align_warp_face()
    for face in helper.cropped_faces:
        t = torch.from_numpy(cv2.cvtColor(face, cv2.COLOR_BGR2RGB).transpose(2, 0, 1)).float().div(255).unsqueeze(0)
        normalize(t[0], (0.5, 0.5, 0.5), (0.5, 0.5, 0.5), inplace=True)
        with torch.no_grad():
            out = net(t, return_rgb=False, weight=a.weight)[0]
        out = out.squeeze(0).clamp(-1, 1).add(1).div(2).mul(255).round().byte().numpy().transpose(1, 2, 0)
        helper.add_restored_face(cv2.cvtColor(out, cv2.COLOR_RGB2BGR))
    helper.get_inverse_affine(None)
    result = helper.paste_faces_to_input_image()
    if not cv2.imwrite(a.dst, result):
        sys.exit("Could not write the output image.")


if __name__ == "__main__":
    main()

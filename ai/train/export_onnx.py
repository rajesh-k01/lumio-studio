#!/usr/bin/env python3
"""Export a trained model to ONNX so it can run without PyTorch (onnxruntime, or a browser with onnxruntime-web)."""
import argparse

import torch

from evaluate import load


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    net, _ = load(a.ckpt)
    x = torch.rand(1, 3, 64, 64)
    torch.onnx.export(net, x, a.out, input_names=["lr"], output_names=["sr"], opset_version=17,
                      dynamic_axes={"lr": {0: "n", 2: "h", 3: "w"}, "sr": {0: "n", 2: "h", 3: "w"}}, dynamo=False)
    print("wrote", a.out)


if __name__ == "__main__":
    main()

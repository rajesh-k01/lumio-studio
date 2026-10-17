#!/usr/bin/env bash
# One-command setup for Lumio's AI enhance (photo and video): Python environment, model weights, face models.
# Usage: bash scripts/setup-ai.sh        (needs python3 and internet; about 2 GB of downloads)
set -euo pipefail
cd "$(dirname "$0")/.."
PY="${PYTHON:-python3}"
"$PY" -m venv ai/venv
ai/venv/bin/pip install --upgrade pip
ai/venv/bin/pip install torch torchvision numpy opencv-python-headless facexlib
mkdir -p ai/models
fetch() { [ -s "ai/models/$1" ] && { echo "have $1"; return; }; curl -fL --retry 3 -o "ai/models/$1" "$2"; }
# Licences: Real-ESRGAN BSD-3-Clause, GFPGAN Apache-2.0. Check each model's licence before you ship it.
fetch realesr-general-x4v3.pth https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth
fetch GFPGANv1.4.pth https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth
# facexlib downloads its face detector and parser on first use; do that now so the first export is not slow.
ai/venv/bin/python - <<'PY'
import os
from facexlib.utils.face_restoration_helper import FaceRestoreHelper
root = os.path.abspath("ai/models/facexlib"); os.makedirs(root, exist_ok=True)
FaceRestoreHelper(1, face_size=512, crop_ratio=(1, 1), det_model="retinaface_resnet50", save_ext="png", use_parse=True, device="cpu", model_rootpath=root)
print("face models ready")
PY
echo
echo "Done. Start Lumio with:"
echo "  LUMIO_AI=1 LUMIO_AI_FACES=1 LUMIO_PYTHON=$PWD/ai/venv/bin/python npm start"

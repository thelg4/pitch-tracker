"""Export a trained RF-DETR checkpoint to the ONNX file the desktop app runs.

    python tools/export_detector.py path/to/weights.pt                  # writes desktop/models/mitt.onnx
    python tools/export_detector.py weights.pt --check frame.png        # also compares ONNX vs PyTorch on a crop

Needs `pip install rfdetr onnx onnxruntime` (a rented-GPU training box already has rfdetr).

The app feeds the model a square, full-resolution crop around the catcher resized to the model's input
(512 x 512 for RF-DETR Small), RGB scaled to 0..1 and normalized with ImageNet mean/std. Outputs:
  dets   [1, Q, 4]  boxes as normalized cx, cy, w, h
  labels [1, Q, C]  class logits (sigmoid gives the score). Roboflow exports put a placeholder superclass at
                    index 0, so a one-class model has C = 2 and its real class at index 1.
"""
import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path

import torch

SIZES = {  # backbone width -> (rfdetr class name, input size)
    384: ('RFDETRSmall', 512),
}
ROOT = Path(__file__).resolve().parent.parent


def inspect_checkpoint(path):
    sd = torch.load(path, map_location='cpu', weights_only=True)['model']
    width = sd['backbone.0.encoder.encoder.embeddings.position_embeddings'].shape[-1]
    classes = sd['class_embed.weight'].shape[0]
    if width not in SIZES:
        sys.exit(f'Unknown backbone width {width}; add it to SIZES.')
    return (*SIZES[width], classes)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('weights')
    ap.add_argument('--out', default=str(ROOT / 'desktop' / 'models' / 'mitt.onnx'))
    ap.add_argument('--labels', default='mitt', help='comma-separated names of the real classes, in order')
    ap.add_argument('--check', help='an image to compare ONNX against PyTorch on')
    a = ap.parse_args()

    import rfdetr
    cls_name, size, logits = inspect_checkpoint(a.weights)
    labels = a.labels.split(',')
    if len(labels) != logits - 1:
        sys.exit(f'The checkpoint has {logits - 1} real classes but --labels names {len(labels)}.')
    model = getattr(rfdetr, cls_name)(pretrain_weights=a.weights, num_classes=len(labels))

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        onnx_path = Path(model.export(output_dir=tmp, shape=(size, size), verbose=False))
        shutil.move(str(onnx_path), out)
    # Written next to the model so the app knows its input size and class names without parsing the graph.
    meta = {'arch': cls_name, 'input': size, 'labels': ['_'] + labels, 'mean': [0.485, 0.456, 0.406], 'std': [0.229, 0.224, 0.225]}
    out.with_suffix('.json').write_text(json.dumps(meta, indent=2) + '\n')
    print(f'Wrote {out} ({out.stat().st_size / 1e6:.0f} MB) and {out.with_suffix(".json").name}')

    if a.check:
        check(model, out, meta, a.check)


def check(model, onnx_path, meta, image):
    import numpy as np
    import onnxruntime as ort
    from PIL import Image
    im = Image.open(image).convert('RGB')
    s = meta['input']
    x = (np.asarray(im.resize((s, s), Image.BILINEAR), dtype=np.float32) / 255 - meta['mean']) / meta['std']
    x = x.transpose(2, 0, 1)[None].astype(np.float32)
    sess = ort.InferenceSession(str(onnx_path), providers=['CPUExecutionProvider'])
    names = [o.name for o in sess.get_outputs()]
    res = dict(zip(names, sess.run(None, {sess.get_inputs()[0].name: x})))
    boxes, scores = res['dets'][0], 1 / (1 + np.exp(-res['labels'][0]))
    best = scores[:, 1:].max(1)
    i = int(best.argmax())
    cx, cy, w, h = boxes[i] * [im.width, im.height, im.width, im.height]
    print(f'ONNX best:    score {best[i]:.2f} at ({cx:.0f}, {cy:.0f}) size {w:.0f}x{h:.0f}')
    d = model.predict(im, threshold=0.05)
    if len(d):
        j = int(d.confidence.argmax())
        x0, y0, x1, y1 = d.xyxy[j]
        print(f'PyTorch best: score {d.confidence[j]:.2f} at ({(x0 + x1) / 2:.0f}, {(y0 + y1) / 2:.0f}) size {x1 - x0:.0f}x{y1 - y0:.0f}')


if __name__ == '__main__':
    main()

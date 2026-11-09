// The trained mitt detector (RF-DETR, exported to ONNX by tools/export_detector.py), run in the main process
// with ONNX Runtime. The renderer hands in a square RGBA crop already resized to the model's input; detect()
// returns the boxes it finds as fractions of that crop. The model loads on first use, and the app works
// without it: info() says whether it is there.
// The CPU provider is used on purpose: for this model it is faster than CoreML (about 55 ms vs 140 ms a frame)
// and loads in a fraction of a second instead of five.
import fs from 'node:fs';

export const MIN_SCORE = 0.15;   // weaker boxes are dropped before they reach the renderer
const MAX_BOXES = 10;

// RGBA bytes (size × size) to the model's input: planar RGB, scaled to 0..1 and normalized.
export function toInput(rgba, size, mean, std){
  const n = size*size, out = new Float32Array(3*n);
  for(let i = 0, j = 0; i < n; i++, j += 4){
    out[i] = (rgba[j]/255 - mean[0])/std[0];
    out[n + i] = (rgba[j+1]/255 - mean[1])/std[1];
    out[2*n + i] = (rgba[j+2]/255 - mean[2])/std[2];
  }
  return out;
}

// The model's outputs to [{x, y, w, h, score, label}] (centre and size as fractions of the crop), best first.
// `dets` holds Q boxes as cx, cy, w, h; `logits` holds Q × C class logits, where class 0 is Roboflow's
// placeholder superclass and never a real detection.
export function decode(dets, logits, classes, labels, minScore = MIN_SCORE){
  const out = [];
  for(let q = 0; q < dets.length/4; q++){
    let best = 0, label = 0;
    for(let c = 1; c < classes; c++){ const s = 1/(1 + Math.exp(-logits[q*classes + c])); if(s > best){ best = s; label = c; } }
    if(best < minScore) continue;
    out.push({x: dets[q*4], y: dets[q*4+1], w: dets[q*4+2], h: dets[q*4+3], score: best, label: labels[label] ?? String(label)});
  }
  return out.sort((a, b) => b.score - a.score).slice(0, MAX_BOXES);
}

// `file` is the .onnx model; its sidecar .json (written by the export script) gives the input size and labels.
export function createDetector(file){
  const metaFile = file.replace(/\.onnx$/, '.json');
  let meta = null, session = null;
  const available = () => fs.existsSync(file) && fs.existsSync(metaFile);
  async function load(){
    if(session) return;
    meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const ort = (await import('onnxruntime-node')).default;
    session = await ort.InferenceSession.create(file, {executionProviders: ['cpu']});
    session.ort = ort;
  }
  return {
    info(){
      if(!available()) return {available: false};
      const m = meta || JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      return {available: true, input: m.input, labels: m.labels.slice(1)};
    },
    async detect(rgba, size){
      await load();
      if(size !== meta.input) throw new Error(`The model takes ${meta.input}px crops, not ${size}px`);
      const {ort} = session, input = new ort.Tensor('float32', toInput(rgba, size, meta.mean, meta.std), [1, 3, size, size]);
      const r = await session.run({[session.inputNames[0]]: input});
      return decode(r.dets.data, r.labels.data, r.labels.dims[2], meta.labels);
    },
  };
}

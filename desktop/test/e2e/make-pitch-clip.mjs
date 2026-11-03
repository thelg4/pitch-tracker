// Generates a 720x1280 60 fps clip of one pitch for the ball-path test: a textured dark background, a "pitcher"
// (a big bright block that moves the whole time), and a white ball released at frame 30 that slows and shrinks
// as it flies away from the camera, caught at frame 55 and held in the glove. Prints the clip's facts as JSON.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '.out');
const FILE = path.join(OUT, 'pitch.mp4');
const W = 720, H = 1280, N = 90, RELEASE = 30, CATCH = 55;
const ball = f => { const u = Math.min(1, Math.max(0, (f - RELEASE)/(CATCH - RELEASE))), e = 1 - (1 - u)**2;
  return {x: 520 - 140*e, y: 760 + 120*e - 40*Math.sin(Math.PI*u), r: 12 - 8*u}; };
const facts = {file: FILE, fps: 60, release: ball(RELEASE), catch: {...ball(CATCH), t: +((CATCH + 0.5)/60).toFixed(3)}};

if(!fs.existsSync(FILE)){
  fs.mkdirSync(OUT, {recursive: true});
  let seed = 3; const rnd = () => (seed = (seed*16807) % 2147483647)/2147483647;
  const bg = new Uint8Array(W*H); for(let i = 0; i < bg.length; i++) bg[i] = 35 + Math.floor(rnd()*25);
  const ff = spawn('/opt/homebrew/bin/ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${W}x${H}`, '-r', '60',
    '-i', '-', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', FILE], {stdio: ['pipe', 'inherit', 'inherit']});
  for(let f = 0; f < N; f++){
    const px = Buffer.from(bg);
    for(let y = 900; y < 1250; y++) for(let x = 400 - 3*f; x < 620 - 3*f; x++) if(x >= 0) px[y*W + x] = 190; // the pitcher
    if(f >= RELEASE){
      const b = ball(f);
      for(let y = Math.floor(b.y - b.r); y <= b.y + b.r; y++) for(let x = Math.floor(b.x - b.r); x <= b.x + b.r; x++)
        if((x - b.x)**2 + (y - b.y)**2 <= b.r*b.r) px[y*W + x] = 235;
    }
    if(!ff.stdin.write(px)) await new Promise(r => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await new Promise((resolve, reject) => ff.on('close', c => c ? reject(new Error(`ffmpeg exited ${c}`)) : resolve()));
}
console.log(JSON.stringify(facts));

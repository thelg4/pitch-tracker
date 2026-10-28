// Scoring and insights, ported from app/bullpen-command.html. Pure functions so the session view,
// the athlete view and the tests share one implementation.
// Settings: {hand:'R'|'L', view:'pitcher'|'catcher', hitR:inches}. Coordinates are frame pixels.

export const TYPES = [['FB','4-Seam'],['SI','Sinker'],['CT','Cutter'],['SL','Slider'],['SW','Sweeper'],['CB','Curve'],['CH','Change'],['SP','Splitter']];
export const TCOL = {FB:'#3D74DB',SI:'#139A9A',CT:'#8A5CD6',SL:'#DD8629',SW:'#C55CAE',CB:'#D2475B',CH:'#3C9C50',SP:'#9F7E3C'};
export const TNAME = Object.fromEntries(TYPES);
export const clamp = (v,a,b) => Math.min(b,Math.max(a,v));
export const fmt = (v,d=1) => (Math.round(v*10**d)/10**d).toFixed(d);

const armSign = s => (s.hand==='R'?1:-1) * (s.view==='pitcher'?1:-1);

export function metrics(p, s){
  const z = p.zone, ppi = z.w/17, t = p.manual || p.glove, a = armSign(s), h = s.hitR;
  const dx = (p.loc.x - t.x)/ppi, dy = (t.y - p.loc.y)/ppi;
  const arm = dx*a, up = dy, d = Math.hypot(dx,dy);
  const score = Math.round(100*clamp((3*h - d)/(3*h - h/3), 0, 1));
  const br = 1.45*ppi;
  const inZone = p.loc.x>=z.x-br && p.loc.x<=z.x+z.w+br && p.loc.y>=z.y-br && p.loc.y<=z.y+z.h+br;
  const tc = Math.floor((t.x-z.x)/(z.w/3)), tr = Math.floor((t.y-z.y)/(z.h/3));
  const outT = tc<0||tc>2||tr<0||tr>2, c = clamp(tc,0,2);
  const setupOff = p.manual && p.glove ? Math.hypot(p.manual.x-p.glove.x, p.manual.y-p.glove.y)/ppi : null;
  return {arm, up, d, score, hit: d<=h, inZone, armCol: a>0 ? c : 2-c, row: clamp(tr,0,2), outT, setupOff, dir: dirLabel(arm,up,d<=h)};
}

// Attach metrics to each pitch: [{...pitch, m}]. Everything below works on scored lists.
export const scored = (pitches, s) => pitches.map(p => ({...p, m: metrics(p, s)}));

const DIRS = ['Arm side','Up & arm side','Up','Up & glove side','Glove side','Down & glove side','Down','Down & arm side'];
export function dirLabel(arm,up,hit){ if(hit) return 'On target'; const k = Math.round(Math.atan2(up,arm)/(Math.PI/4)); return DIRS[(k+8)%8]; }

export function summary(list){
  const ms = list.map(p => p.m), n = ms.length;
  if(!n) return {n:0};
  const avg = f => ms.reduce((s,m)=>s+f(m),0)/n;
  return {n, ms, score: avg(m=>m.score), hit: avg(m=>m.hit?1:0), d: avg(m=>m.d), arm: avg(m=>m.arm), up: avg(m=>m.up), zone: avg(m=>m.inZone?1:0)};
}
export const grade = s => clamp(20 + Math.round(s*0.6/5)*5, 20, 80);
export const tone = s => s>=70 ? 'good' : s>=50 ? 'warn' : 'bad';
export const GRADE_TXT = {80:'Elite command',75:'Plus-plus',70:'Plus',65:'Above average',60:'Above average',55:'Average',50:'Average',45:'Below average',40:'Below average',35:'Well below',30:'Well below',25:'Poor',20:'Poor'};
export function sideWord(v, pos, neg){ return Math.abs(v)<0.75 ? null : `${fmt(Math.abs(v))}" ${v>0?pos:neg}`; }

export function byType(list){
  const g = {}; list.forEach(p => (g[p.type] = g[p.type] || []).push(p));
  return Object.entries(g).filter(([,l])=>l.length>=2).map(([type,l]) => ({type, ...summary(l)})).sort((a,b)=>b.score-a.score);
}

export function heatCells(ms){
  const rows = ['Up','Middle','Down'], cols = ['glove side','middle','arm side'];
  const cells = []; for(let r=0;r<3;r++) for(let c=0;c<3;c++) cells.push({r,c,n:0,h:0,sc:0,label: r===1&&c===1 ? 'middle-middle' : `${rows[r].toLowerCase()} ${cols[c]}`.replace('middle middle','middle')});
  ms.forEach(m => { if(m.outT) return; const cell = cells[m.row*3+m.armCol]; cell.n++; cell.h += m.hit?1:0; cell.sc += m.score; });
  cells.forEach(c => { c.hit = c.n ? c.h/c.n : 0; c.score = c.n ? c.sc/c.n : 0; });
  return cells;
}

// Written findings as [html, tone] pairs.
export function insights(list){
  const s = summary(list), out = [];
  if(s.n < 5) return [['Tag at least 5 pitches to see reliable trends.','']];
  const bias = [sideWord(s.arm,'arm side','glove side'), sideWord(s.up,'up','down')].filter(Boolean);
  out.push(bias.length ? [`Average miss lands <b>${bias.join(' and ')}</b> of the target.`, Math.hypot(s.arm,s.up)>2.5?'bad':'warn'] : ['No consistent directional bias. Misses scatter evenly around the target.','good']);
  const misses = s.ms.filter(m=>!m.hit);
  if(misses.length >= 3){
    const cnt = {}; misses.forEach(m=>cnt[m.dir]=(cnt[m.dir]||0)+1);
    const [dir,c] = Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0];
    out.push([`Most common miss: <b>${dir.toLowerCase()}</b>, ${c} of ${misses.length} misses (${Math.round(c/misses.length*100)}%).`, c/misses.length>=.4?'bad':'warn']);
  }
  const types = byType(list);
  if(types.length > 1){
    const best = types[0], worst = types[types.length-1];
    const wb = [sideWord(worst.arm,'arm side','glove side'), sideWord(worst.up,'up','down')].filter(Boolean);
    out.push([`<b>${TNAME[worst.type]}</b> has the loosest command at ${Math.round(worst.score)} (${fmt(worst.d)}" avg miss${wb.length?', leaking '+wb.join(' and '):''}).`, 'bad']);
    out.push([`<b>${TNAME[best.type]}</b> is the sharpest pitch at ${Math.round(best.score)}, hitting ${Math.round(best.hit*100)}% of targets.`, 'good']);
  }
  if(s.n >= 12){
    const k = Math.floor(s.n/3), early = s.ms.slice(0,k), late = s.ms.slice(-k);
    const e = early.reduce((a,m)=>a+m.score,0)/k, l = late.reduce((a,m)=>a+m.score,0)/k;
    if(l - e <= -8) out.push([`Command fades late: first ${k} pitches averaged ${Math.round(e)}, last ${k} averaged ${Math.round(l)}. Possible fatigue or a mechanical drift.`, 'bad']);
    else if(l - e >= 8) out.push([`Command sharpened as the pen went on, from ${Math.round(e)} early to ${Math.round(l)} late. Look at the warm-up routine.`, 'warn']);
    else out.push([`Command held steady from start to finish (${Math.round(e)} early, ${Math.round(l)} late).`, 'good']);
  }
  const cells = heatCells(s.ms).filter(c=>c.n>=3).sort((a,b)=>a.hit-b.hit);
  if(cells.length >= 2 && cells[0].hit < s.hit - .1) out.push([`Weakest target area: <b>${cells[0].label}</b>, hitting ${Math.round(cells[0].hit*100)}% there vs ${Math.round(s.hit*100)}% overall.`, 'warn']);
  const comp = s.ms.filter(m=>!m.hit && m.inZone).length, wild = s.ms.filter(m=>!m.inZone).length;
  if(misses.length) out.push([`${comp} of ${misses.length} misses still landed in the zone. ${wild} pitch${wild===1?'':'es'} finished outside it.`, wild/s.n > .3 ? 'bad' : '']);
  const off = s.ms.filter(m=>m.setupOff!=null);
  if(off.length) out.push([`Manual target used on ${off.length} pitch${off.length===1?'':'es'}. The catcher's setup was ${fmt(off.reduce((a,m)=>a+m.setupOff,0)/off.length)}" off on average.`, '']);
  return out;
}

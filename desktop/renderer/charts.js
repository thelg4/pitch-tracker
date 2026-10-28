// SVG/HTML chart builders. Each takes a scored pitch list ([{...pitch, m}]) and returns markup.
import { TCOL, TNAME, fmt, summary, heatCells, tone, grade, sideWord } from './scoring.js';
import { esc, fmtDate } from './util.js';

export function scatter(list, hitR, selectedId){
  const W=320, H=320, cx=160, cy=150, h=hitR, R = Math.max(18, ...list.map(p=>p.m.d)) * 1.08, k = 130/R;
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px" role="img" aria-label="Miss locations relative to target">`;
  svg += `<line class="axis" x1="${cx-140}" y1="${cy}" x2="${cx+140}" y2="${cy}"/><line class="axis" x1="${cx}" y1="${cy-140}" x2="${cx}" y2="${cy+140}"/>`;
  [[h,'hit'],[2*h,''],[3*h,'0 pts']].forEach(([r,l]) => { if(r*k<=140){ svg += `<circle cx="${cx}" cy="${cy}" r="${r*k}" fill="none" class="grid"/><text x="${cx+r*k*0.71+3}" y="${cy-r*k*0.71-3}">${r}"${l?' '+l:''}</text>`; }});
  svg += `<circle cx="${cx}" cy="${cy}" r="${h*k}" fill="var(--good)" fill-opacity=".08" stroke="var(--good)" stroke-opacity=".6"/>`;
  svg += `<text x="${cx+136}" y="${cy-5}" text-anchor="end">ARM SIDE →</text><text x="${cx-136}" y="${cy-5}">← GLOVE</text><text x="${cx+5}" y="${cy-132}">UP</text><text x="${cx+5}" y="${cy+140}">DOWN</text>`;
  list.forEach(p => { const m = p.m, x=cx+m.arm*k, y=cy-m.up*k;
    svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${p.id===selectedId?7:5}" fill="${p.manual?'none':TCOL[p.type]}" stroke="${TCOL[p.type]}" stroke-width="${p.manual?2:1}" fill-opacity=".85"><title>#${p.n} ${p.type} · ${fmt(m.d)}" ${m.dir}</title></circle>`; });
  const s = summary(list);
  if(s.n){ const x=cx+s.arm*k, y=cy-s.up*k; svg += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--ink)" stroke-width="2.5" marker-end="url(#ah)"/><defs><marker id="ah" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--ink)"/></marker></defs>`; }
  return svg + `<circle cx="${cx}" cy="${cy}" r="3" fill="var(--ink)"/></svg>`;
}

export function legend(list){
  const types = [...new Set(list.map(p=>p.type))];
  return types.map(t=>`<span><i style="background:${TCOL[t]}"></i>${TNAME[t]}</span>`).join('') + '<span><i style="border:2px solid var(--muted)"></i>Manual target</span><span>➝ average miss</span>';
}

export function heat(list){
  const ms = list.map(p=>p.m), cells = heatCells(ms), out = ms.filter(m=>m.outT).length;
  let h = '<div class="heat"><span></span><span class="cl">Glove side</span><span class="cl">Middle</span><span class="cl">Arm side</span>';
  ['Up','Mid','Down'].forEach((r,ri) => { h += `<span class="rl">${r}</span>`;
    for(let c=0;c<3;c++){ const cell = cells[ri*3+c];
      if(!cell.n){ h += `<div class="c" style="border:1px dashed var(--line)"><span class="hint">no targets</span></div>`; continue; }
      const t = tone(cell.score), mix = 12 + Math.round(cell.hit*30);
      h += `<div class="c" style="background:color-mix(in srgb,var(--${t}) ${mix}%,transparent);" title="Average score ${Math.round(cell.score)}"><b>${Math.round(cell.hit*100)}%</b><span>${cell.h}/${cell.n} hit</span></div>`; } });
  h += '</div>';
  if(out) h += `<span class="hint">${out} target${out>1?'s':''} set outside the zone (chase spots) not shown.</span>`;
  return h;
}

// Line chart of 0–100 values. points: [{v, dotV?, color?, label, title}]; the line is `v`, dots are `dotV ?? v`.
// size {w, h} sets the viewBox, so a narrow panel can draw it at a scale where its labels stay readable.
function lineChart(points, aria, {w: W = 560, h: H = 220} = {}){
  const L=30, B=24, T=10, Rr=10, n=points.length;
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${aria}">`;
  const x = i => L + (n<=1 ? (W-L-Rr)/2 : i*(W-L-Rr)/(n-1)), y = v => T + (100-v)*(H-T-B)/100;
  [0,25,50,75,100].forEach(v => svg += `<line stroke="rgba(255,255,255,.07)" x1="${L}" x2="${W-Rr}" y1="${y(v)}" y2="${y(v)}"/><text x="${L-6}" y="${y(v)+3}" text-anchor="end">${v}</text>`);
  if(n){
    const pts = points.map((p,i)=>`${x(i).toFixed(1)},${y(p.v).toFixed(1)}`);
    svg += `<path class="area" d="M${x(0)},${y(0)} L${pts.join(' L')} L${x(n-1)},${y(0)} Z" fill="var(--accent)" fill-opacity=".16"/>`;
    points.forEach((p,i)=> svg += `<circle cx="${x(i).toFixed(1)}" cy="${y(p.dotV ?? p.v).toFixed(1)}" r="3" fill="${p.color || 'var(--accent)'}" fill-opacity=".85"><title>${esc(p.title)}</title></circle>`);
    svg += `<polyline class="draw" pathLength="1" points="${pts.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    svg += `<circle cx="${x(n-1)}" cy="${y(points[n-1].v)}" r="5" fill="var(--accent)" stroke="var(--bg)" stroke-width="2"/>`;
    const ticks = n<=8 ? points.map((_,i)=>i) : [0, Math.floor((n-1)/2), n-1];
    ticks.forEach(i => svg += `<text x="${x(i)}" y="${H-8}" text-anchor="middle">${esc(points[i].label)}</text>`);
  }
  return svg + '</svg>';
}

// Pitch-by-pitch score with a 5-pitch rolling average. `size` is passed to lineChart.
export function rollingTrend(list, size){
  const roll = list.map((_,i) => { const w = list.slice(Math.max(0,i-4),i+1); return w.reduce((a,p)=>a+p.m.score,0)/w.length; });
  return lineChart(list.map((p,i) => ({v: roll[i], dotV: p.m.score, color: TCOL[p.type], label: '#'+p.n, title: `#${p.n} ${p.type}: ${p.m.score}`})), 'Score by pitch', size);
}

// Command score per session, oldest first. sessions: [{recordedOn, list}]
export function sessionTrend(sessions){
  const pts = sessions.filter(s => s.list.length).map(s => { const sm = summary(s.list);
    return {v: sm.score, label: fmtDate(s.recordedOn).replace(/, \d{4}$/, ''), title: `${fmtDate(s.recordedOn)}: ${Math.round(sm.score)} (${sm.n} pitches)`}; });
  return lineChart(pts, 'Command score by session');
}

export function typeTable(list){
  const g = {}; list.forEach(p => (g[p.type]=g[p.type]||[]).push(p));
  const rows = Object.entries(g).map(([t,l])=>({t,...summary(l)})).sort((a,b)=>b.n-a.n);
  if(!rows.length) return '';
  return `<table><thead><tr><th>Pitch</th><th class="num">Count</th><th class="num">Score</th><th class="num">Grade</th><th class="num">Hit %</th><th class="num">Avg miss</th><th>Average miss direction</th><th class="num">In zone</th></tr></thead><tbody>` +
    rows.map(r => { const b = [sideWord(r.arm,'arm','glove'), sideWord(r.up,'up','down')].filter(Boolean).join(', ') || 'centered';
      return `<tr><td><span class="dot" style="background:${TCOL[r.t]}"></span>${TNAME[r.t]}</td><td class="num mono">${r.n}</td><td class="num mono"><span class="pill ${tone(r.score)}">${Math.round(r.score)}</span></td><td class="num mono">${grade(r.score)}</td><td class="num mono">${Math.round(r.hit*100)}%</td><td class="num mono">${fmt(r.d)}"</td><td>${b}</td><td class="num mono">${Math.round(r.zone*100)}%</td></tr>`; }).join('') + '</tbody></table>';
}

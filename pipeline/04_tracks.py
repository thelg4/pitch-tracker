import pickle, numpy as np, sys, json
d = sys.argv[1]
c = pickle.load(open(f'{d}/cands.pkl','rb'))
def near(f, p, r):
    best=None; bd=r
    for q in c.get(f, []):
        dd = np.hypot(q[0]-p[0], q[1]-p[1])
        if dd < bd: bd, best = dd, q
    return best
chains=[]
for f in sorted(c):
    for s in c[f]:
        if s[2] < 40: continue
        ch=[(f,)+s]; vel=None; miss=0; fr=f
        while True:
            fr += 1
            if vel is None:
                nx = None; bd=16
                for q in c.get(fr, []):
                    dd=np.hypot(q[0]-s[0], q[1]-s[1])
                    if 1.5 < dd < bd and q[2] <= s[2]*1.6+6: bd, nx = dd, q
            else:
                last=ch[-1]; k=fr-last[0]
                pred=(last[1]+vel[0]*k*0.92, last[2]+vel[1]*k*0.92)
                nx = near(fr, pred, 3.5+1.5*k)
                if nx and nx[2] > last[3]*1.7+6: nx=None
            if nx:
                pv = ch[-1]; k = fr-pv[0]
                v = ((nx[0]-pv[1])/k, (nx[1]-pv[2])/k)
                vel = v if vel is None else (0.5*vel[0]+0.5*v[0], 0.5*vel[1]+0.5*v[1])
                ch.append((fr,)+nx); miss=0
            else:
                miss += 1
                if miss > 1 or vel is None: break
        if len(ch) >= 6:
            net = np.hypot(ch[-1][1]-ch[0][1], ch[-1][2]-ch[0][2])
            a0 = np.mean([q[3] for q in ch[:3]]); a1 = np.mean([q[3] for q in ch[-3:]])
            a_start=max(q[3] for q in ch[:3])
            dx=ch[-1][1]-ch[0][1]; dy=ch[-1][2]-ch[0][2]
            if a_start >= 50 and a1 <= a0*0.4 and 8 <= len(ch) <= 40 and dy >= 25 and dx <= 5 and ch[0][1] >= 170 and ch[-1][2] >= 180: chains.append(ch)
# keep best chain per 2.5 s window
chains.sort(key=lambda ch: -len(ch))
kept=[]
for ch in chains:
    if all(abs(ch[-1][0]-k[-1][0]) > 150 for k in kept): kept.append(ch)
kept.sort(key=lambda ch: ch[0][0])
print(len(kept))
for ch in kept:
    print(ch[0][0], ch[-1][0], round(ch[-1][0]/59.959,2), len(ch), 'start', (round(ch[0][1]),round(ch[0][2]),ch[0][3]), 'end', (round(ch[-1][1]),round(ch[-1][2]),ch[-1][3]))
pickle.dump(kept, open(f'{d}/chains.pkl','wb'))

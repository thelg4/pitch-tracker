# Build per-frame render plan: segments, camera offsets, crop centres, overlays.
import numpy as np, cv2, json, pickle, sys
d = sys.argv[1]
cr = np.load(f'{d}/crop.npy', mmap_mode='r'); N = len(cr)
info = {x['n']: x for x in json.load(open(f'{d}/info.json'))}
chains = pickle.load(open(f'{d}/chains.pkl','rb'))
g2 = {r['n']: r for r in json.load(open(f'{d}/glove2.json'))}
gr = {r['n']: r for r in json.load(open(f'{d}/glove_retry.json'))}
OX, OY = 270, 882
verified = {0,3,5,8,9,11,14,18,25,29,31,32,33}
glove = {n: (g2[n]['setup_f'], g2[n]['glove4k']) for n in verified}
for n in (1,19): glove[n] = (gr[n]['setup_f'], gr[n]['glove4k'])
drop = {2,4,6,10,13,17}
mf = np.load(f'{d}/mf.npy')
cuts = [i for i in range(90, N-90) if mf[i] > 8 and mf[i] == mf[i-90:i+91].max()]
bounds = [0] + cuts + [N]
win = cv2.createHanningWindow((282,160), cv2.CV_32F)
def patch(f): return cv2.cvtColor(np.ascontiguousarray(cr[f][0:160,150:432]), cv2.COLOR_BGR2GRAY).astype(np.float32)
# catch index within each chain (same rule as review)
def catch_i(ch):
    for i in range(3, len(ch)):
        v = ((ch[i-1][1]-ch[i-3][1])/2, (ch[i-1][2]-ch[i-3][2])/2)
        if np.hypot(ch[i][1]-(ch[i-1][1]+v[0]*.92), ch[i][2]-(ch[i-1][2]+v[1]*.92)) > 3.2: return i-1
    return len(ch)-1
pitches = []
for n, ch in enumerate(chains):
    if n in drop: continue
    ci = catch_i(ch); pts = [(q[0], q[1]+OX, q[2]+OY) for q in ch[:ci+1]]
    pitches.append(dict(n=n, pts=pts, catch_f=pts[-1][0], glove=glove.get(n)))
pitches.sort(key=lambda p: p['catch_f'])
for k, p in enumerate(pitches): p['num'] = k+1
off = np.zeros((N,2)); seg_of = np.zeros(N, int); seg_ref = []
for si in range(len(bounds)-1):
    a, b = bounds[si], bounds[si+1]
    inseg = [p for p in pitches if a <= p['catch_f'] < b]
    ref = inseg[0]['catch_f'] if inseg else (a+b)//2
    seg_ref.append(ref); R = patch(ref); last = (0.,0.)
    for f in range(a, b):
        (dx, dy), r = cv2.phaseCorrelate(R, patch(f), win)
        if r < 0.12 or np.hypot(dx-last[0], dy-last[1]) > 25: dx, dy = last
        off[f] = (dx, dy); last = (dx, dy); seg_of[f] = si
# light temporal smoothing within segments
sm = off.copy()
for f in range(N):
    a = max(bounds[seg_of[f]], f-3); b = min(bounds[seg_of[f]+1], f+4)
    sm[f] = np.median(off[a:b], axis=0)
# crop anchor per segment, in ref-frame full-res coords
anchors = []
for si in range(len(bounds)-1):
    a, b = bounds[si], bounds[si+1]
    inseg = [p for p in pitches if a <= p['catch_f'] < b]
    if inseg:
        p = inseg[0]
        if p['glove']:
            sf, g4 = p['glove']; anchors.append((g4[0]/2 - sm[sf][0], g4[1]/2 - sm[sf][1]))
        else:
            _, x, y = p['pts'][-1]; anchors.append((x - 4, y + 22))
    else:
        anchors.append(anchors[-1] if anchors else (470, 1130))
plan = dict(N=N, bounds=bounds, off=sm.tolist(), seg_of=seg_of.tolist(), anchors=anchors, pitches=pitches)
json.dump(plan, open(f'{d}/plan.json','w'))
print(len(bounds)-1, 'segments', len(pitches), 'pitches', sum(1 for p in pitches if p['glove']), 'with target')

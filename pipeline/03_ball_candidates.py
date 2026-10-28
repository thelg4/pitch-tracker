import numpy as np, cv2, sys, pickle, time
d = sys.argv[1]
cr = np.load(f'{d}/crop.npy', mmap_mode='r'); N = len(cr)
H, W = cr.shape[1:3]
win = cv2.createHanningWindow((W-150, 160), cv2.CV_32F)
def gray(i): return cv2.cvtColor(np.ascontiguousarray(cr[i]), cv2.COLOR_BGR2GRAY).astype(np.float32)
def shift_of(a, b):  # translation that maps b onto a, from the back wall
    (dx, dy), r = cv2.phaseCorrelate(b[0:160,150:], a[0:160,150:], win); return dx, dy, r
def warp(b, dx, dy): return cv2.warpAffine(b, np.float32([[1,0,dx],[0,1,dy]]), (W,H), borderMode=cv2.BORDER_REPLICATE)
cands = {}; shifts = np.zeros((N,3)); t = time.time()
G = [gray(0), gray(1)]
for i in range(1, N-1):
    G.append(gray(i+1)); a, g, b = G[-3], G[-2], G[-1]
    dxa, dya, ra = shift_of(g, a); dxb, dyb, rb = shift_of(g, b); shifts[i] = (dxa, dya, ra)
    m = np.minimum(g - warp(a, dxa, dya), g - warp(b, dxb, dyb))
    mask = ((m > 22) & (g > 120)).astype(np.uint8)
    n, lab, st, cen = cv2.connectedComponentsWithStats(mask)
    out = []
    for k in range(1, n):
        x, y, w, h, area = st[k]
        if 3 <= area <= 140 and w <= 18 and h <= 18 and max(w,h) <= 2.6*min(w,h)+1:
            out.append((float(cen[k][0]), float(cen[k][1]), int(area), float(m[lab==k].mean())))
    if out: cands[i] = out
    G.pop(0)
    if i % 2000 == 0: print(i, round(time.time()-t), flush=True)
pickle.dump(cands, open(f'{d}/cands.pkl','wb')); np.save(f'{d}/shifts.npy', shifts); print('done', len(cands))

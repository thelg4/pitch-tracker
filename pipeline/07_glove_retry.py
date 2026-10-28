import numpy as np, cv2, json, pickle, sys
d, src = sys.argv[1], sys.argv[2]
cr = np.load(f'{d}/crop.npy', mmap_mode='r')
info = json.load(open(f'{d}/info.json')); chains = pickle.load(open(f'{d}/chains.pkl','rb'))
drop = {2,4,6,10,13,17,0,3,5,8,9,11,14,18,25,29,31,32,33}
OX, OY = 270, 882
cap = cv2.VideoCapture(src)
def f4k(f): cap.set(cv2.CAP_PROP_POS_FRAMES, f); return cap.read()[1]
def blobs(fr):
    hsv = cv2.cvtColor(np.ascontiguousarray(fr), cv2.COLOR_BGR2HSV)
    m = ((hsv[...,0]>100)&(hsv[...,0]<130)&(hsv[...,1]>90)&(hsv[...,2]>50)).astype(np.uint8)
    n, lab, st, cen = cv2.connectedComponentsWithStats(m)
    return [st[k] for k in range(1,n) if st[k][4] >= 20]
def find_catcher(fr, near):
    bs = blobs(fr); big = [b for b in bs if b[4] > 1500]
    best = None
    for b in bs:
        x,y,w,h,a = b
        if not (130 <= a <= 600 and 16 <= w <= 34 and 14 <= h <= 34): continue
        below = [c for c in bs if c is not b and 60 <= c[4] <= 600 and abs((c[0]+c[2]/2)-(x+w/2)) < 18 and 0 <= c[1]-(y+h) < 14]
        if not below: continue
        occl = any(not (bx+bw < x-10 or bx > x+w+25 or by+bh < y-15 or by > y+h+40) for bx,by,bw,bh,_ in big)
        dist = np.hypot(x+w/2-near[0], y+h/2-near[1])
        sc = dist + (1000 if occl else 0)
        if best is None or sc < best[0]: best = (sc, (x,y,w,h), occl)
    return best
def motion(f, box):
    x,y,w,h = box; x0,y0 = max(0,x-8), max(0,y-6)
    a = cv2.cvtColor(np.ascontiguousarray(cr[f][y0:y+h+34, x0:x+w+20]), cv2.COLOR_BGR2GRAY).astype(np.float32)
    b = cv2.cvtColor(np.ascontiguousarray(cr[f+1][y0:y+h+34, x0:x+w+20]), cv2.COLOR_BGR2GRAY).astype(np.float32)
    return np.abs(a-b).mean()
res=[]; tiles=[]
for x in info:
    if x['n'] in drop: continue
    s = chains[x['n']][0][0]; cx, cy = x['catch']
    cand=[]
    for f in range(s-200, s-1):
        c = find_catcher(cr[f], (cx, cy+15))
        if c and not c[2] and c[0] < 140: cand.append((motion(f, c[1]) + 0.015*(s-f), f, c[1]))
    if not cand: res.append(dict(n=x['n'], ok=False)); print(x['n'], 'no clean setup'); continue
    _, sf, (bx,by,bw,bh) = min(cand)
    fr = f4k(sf)
    # mitt: dark, not blue, below/around the bottom of the chest protector
    X0, Y0 = 2*(bx-8+OX), 2*(by+bh-8+OY); X1, Y1 = 2*(bx+bw+16+OX), 2*(by+bh+30+OY)
    roi = fr[Y0:Y1, X0:X1]; hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    h_, s_, v_ = [hsv[...,i].astype(int) for i in range(3)]
    m = ((v_ < 80) & ~((h_>95)&(h_<135)&(s_>60))).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3,3),np.uint8))
    n, lab, st, cen = cv2.connectedComponentsWithStats(m)
    pick = max(((st[k][4], cen[k]) for k in range(1,n) if 30 <= st[k][4] <= 2500), default=None, key=lambda t: t[0])
    g = None if pick is None else (X0+pick[1][0], Y0+pick[1][1])
    res.append(dict(n=x['n'], ok=g is not None, setup_f=sf, catcher=[int(bx),int(by),int(bw),int(bh)], glove4k=None if g is None else [round(g[0],1),round(g[1],1)]))
    cxp, cyp = 2*(bx+bw//2+OX), 2*(by+bh+OY)
    t = fr[cyp-70:cyp+90, cxp-80:cxp+80].copy(); t = cv2.resize(t, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    if g: cv2.drawMarker(t, (int((g[0]-cxp+80)*2), int((g[1]-cyp+70)*2)), (0,255,0), cv2.MARKER_TILTED_CROSS, 22, 2)
    cv2.putText(t, f"#{x['n']} f{sf}", (4,20), cv2.FONT_HERSHEY_SIMPLEX, .6, (255,255,255), 2)
    tiles.append(t)
for i in range(0, len(tiles), 14):
    grp = tiles[i:i+14]
    while len(grp)%7: grp.append(np.zeros_like(tiles[0]))
    cv2.imwrite(f'{d}/gr_{i//14}.jpg', np.vstack([np.hstack(grp[j:j+7]) for j in range(0,len(grp),7)]), [cv2.IMWRITE_JPEG_QUALITY,85])
json.dump(res, open(f'{d}/glove_retry.json','w'))
print(sum(r['ok'] for r in res), len(res))

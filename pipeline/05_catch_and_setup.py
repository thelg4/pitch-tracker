import numpy as np, cv2, pickle, sys, json
d = sys.argv[1]
cr = np.load(f'{d}/crop.npy', mmap_mode='r')
chains = pickle.load(open(f'{d}/chains.pkl','rb'))
K = 4; B = 30  # half box
win = cv2.createHanningWindow((282,160), cv2.CV_32F)
def g(f): return cv2.cvtColor(np.ascontiguousarray(cr[f]), cv2.COLOR_BGR2GRAY).astype(np.float32)
def catch_pt(ch):
    for i in range(3, len(ch)):
        v = ((ch[i-1][1]-ch[i-3][1])/2, (ch[i-1][2]-ch[i-3][2])/2)
        pred = (ch[i-1][1]+v[0]*0.92, ch[i-1][2]+v[1]*0.92)
        if np.hypot(ch[i][1]-pred[0], ch[i][2]-pred[1]) > 3.2: return i-1
    return len(ch)-1
def tile(f, cx, cy, pts, cross, label):
    x0,y0 = int(cx-B), int(cy-B); x0=max(0,min(432-2*B,x0)); y0=max(0,min(308-2*B,y0))
    im = cv2.resize(np.ascontiguousarray(cr[f][y0:y0+2*B, x0:x0+2*B]), None, fx=K, fy=K, interpolation=cv2.INTER_CUBIC)
    for gx in range((x0//5+1)*5, x0+2*B, 5):
        X=int((gx-x0)*K); cv2.line(im,(X,0),(X,239),(0,200,255) if gx%10==0 else (70,70,70),1)
        if gx%10==0: cv2.putText(im,str(gx),(X+1,236),cv2.FONT_HERSHEY_PLAIN,.75,(0,255,255),1)
    for gy in range((y0//5+1)*5, y0+2*B, 5):
        Y=int((gy-y0)*K); cv2.line(im,(0,Y),(239,Y),(0,200,255) if gy%10==0 else (70,70,70),1)
        if gy%10==0: cv2.putText(im,str(gy),(1,Y-1),cv2.FONT_HERSHEY_PLAIN,.75,(0,255,255),1)
    for (px,py) in pts: cv2.circle(im,(int((px-x0)*K),int((py-y0)*K)),2,(255,0,255),-1)
    if cross: X,Y=int((cross[0]-x0)*K),int((cross[1]-y0)*K); cv2.drawMarker(im,(X,Y),(0,255,0),cv2.MARKER_CROSS,14,1)
    cv2.putText(im,label,(3,14),cv2.FONT_HERSHEY_SIMPLEX,.45,(255,255,255),2)
    return im, (x0,y0)
info=[]; tiles=[]
for n,ch in enumerate(chains):
    ci = catch_pt(ch); cf, cx, cy = ch[ci][0], ch[ci][1], ch[ci][2]
    s = ch[0][0]
    # setup: stillest frame in the catcher box shortly before the ball appears
    bx0,by0 = int(max(0,cx-B)), int(max(0,cy-B))
    best=None
    for f in range(s-70, s-2):
        a=g(f)[by0:by0+2*B, bx0:bx0+2*B]; b=g(f+1)[by0:by0+2*B, bx0:bx0+2*B]
        m=np.abs(a-b).mean() + 0.02*(s-f)
        if best is None or m < best[0]: best=(m,f)
    sf = best[1]
    (dx,dy),r = cv2.phaseCorrelate(g(sf)[0:160,150:], g(cf)[0:160,150:], win)  # shift setup->catch
    t1,_ = tile(sf, cx-dx, cy-dy, [], None, f'#{n} SETUP f{sf}')
    t2,_ = tile(cf, cx, cy, [(q[1],q[2]) for q in ch[:ci+1]], (cx,cy), f'#{n} CATCH f{cf}')
    tiles += [t1,t2]
    info.append(dict(n=n, start=s, setup_f=sf, catch_f=cf, catch=(round(cx,1),round(cy,1)), cam_shift=(round(dx,1),round(dy,1)), corr=round(r,2)))
for i in range(0,len(tiles),16):
    grp=tiles[i:i+16]
    while len(grp)%8: grp.append(np.zeros_like(tiles[0]))
    cv2.imwrite(f'{d}/r2_{i//16}.jpg', np.vstack([np.hstack(grp[j:j+8]) for j in range(0,len(grp),8)]), [cv2.IMWRITE_JPEG_QUALITY,85])
json.dump(info, open(f'{d}/info.json','w'), indent=0)
for x in info: print(x)

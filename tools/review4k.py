import numpy as np, cv2, pickle, sys, json
d, src = sys.argv[1], sys.argv[2]
info = json.load(open(f'{d}/info.json')); chains = pickle.load(open(f'{d}/chains.pkl','rb'))
drop = {2,4,6,10,13,17}
cap = cv2.VideoCapture(src)
OX, OY = 270, 882; B = 32; K = 4  # B in 1080p px; tile = 2B*2 4K px scaled x2 => 256
def frame4k(f): cap.set(cv2.CAP_PROP_POS_FRAMES, f); ok, fr = cap.read(); return fr
def tile(fr, cx, cy, pts, cross, label):
    x0, y0 = int(cx-B), int(cy-B)
    X0, Y0 = 2*(x0+OX), 2*(y0+OY)
    im = cv2.resize(fr[Y0:Y0+4*B, X0:X0+4*B], None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)  # 1 crop px = 4 tile px
    for gx in range((x0//5+1)*5, x0+2*B, 5):
        X=(gx-x0)*K; cv2.line(im,(X,0),(X,255),(0,200,255) if gx%10==0 else (60,60,60),1)
        if gx%10==0: cv2.putText(im,str(gx),(X+1,252),cv2.FONT_HERSHEY_PLAIN,.8,(0,255,255),1)
    for gy in range((y0//5+1)*5, y0+2*B, 5):
        Y=(gy-y0)*K; cv2.line(im,(0,Y),(255,Y),(0,200,255) if gy%10==0 else (60,60,60),1)
        if gy%10==0: cv2.putText(im,str(gy),(1,Y-2),cv2.FONT_HERSHEY_PLAIN,.8,(0,255,255),1)
    for (px,py) in pts: cv2.circle(im,(int((px-x0)*K),int((py-y0)*K)),2,(255,0,255),-1)
    if cross: cv2.drawMarker(im,(int((cross[0]-x0)*K),int((cross[1]-y0)*K)),(0,255,0),cv2.MARKER_CROSS,16,1)
    cv2.putText(im,label,(3,15),cv2.FONT_HERSHEY_SIMPLEX,.5,(255,255,255),2)
    return im
tiles=[]
for x in info:
    if x['n'] in drop: continue
    ch = chains[x['n']]; cx, cy = x['catch']; dx, dy = x['cam_shift']
    # centre both tiles a bit below/left of the catch so the catcher's body shows
    tx, ty = cx-6, cy+8
    tiles.append(tile(frame4k(x['setup_f']), tx-dx, ty-dy, [], None, f"#{x['n']} SETUP"))
    tiles.append(tile(frame4k(x['catch_f']), tx, ty, [(q[1],q[2]) for q in ch if q[0]<=x['catch_f']], (cx,cy), f"#{x['n']} CATCH"))
for i in range(0,len(tiles),16):
    grp=tiles[i:i+16]
    while len(grp)%8: grp.append(np.zeros_like(tiles[0]))
    cv2.imwrite(f'{d}/k_{i//16}.jpg', np.vstack([np.hstack(grp[j:j+8]) for j in range(0,len(grp),8)]), [cv2.IMWRITE_JPEG_QUALITY,88])
print(len(tiles)//2)

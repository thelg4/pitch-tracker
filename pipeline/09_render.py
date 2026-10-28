import numpy as np, cv2, json, sys, time
d, src, out = sys.argv[1], sys.argv[2], sys.argv[3]
f0 = int(sys.argv[4]) if len(sys.argv) > 4 else 0
f1 = int(sys.argv[5]) if len(sys.argv) > 5 else None
snaps = set(int(v) for v in sys.argv[6].split(',')) if len(sys.argv) > 6 else set()
P = json.load(open(f'{d}/plan.json')); N = P['N']; f1 = f1 or N
off = np.array(P['off']); seg = P['seg_of']; anchors = P['anchors']
W, H = 1920, 1080; LW = 608; RW = W - LW
CW, CH = 220, 220*H/RW            # crop size in 1080p px (~6x of 1080p, ~3x of 4K)
GREEN, YEL, ORG, WHITE = (80,230,90), (40,220,255), (40,140,255), (255,255,255)
pit = P['pitches']
for p in pit:
    p['ptmap'] = {f: (x, y) for f, x, y in p['pts']}
    p['start'] = (p['glove'][0] if p['glove'] else p['pts'][0][0] - 30)
    p['end'] = p['catch_f'] + 75
    if p['glove']:
        sf, g4 = p['glove']; p['Gref'] = (g4[0]/2 - off[sf][0], g4[1]/2 - off[sf][1])
    cf = p['catch_f']; cx, cy = p['ptmap'][cf]; p['Cref'] = (cx - off[cf][0], cy - off[cf][1])
def active(f): return next((p for p in pit if p['start'] <= f <= p['end']), None)
def label(img, text, org, col=WHITE, sc=.8, th=2):
    cv2.putText(img, text, org, cv2.FONT_HERSHEY_SIMPLEX, sc, (0,0,0), th+3, cv2.LINE_AA)
    cv2.putText(img, text, org, cv2.FONT_HERSHEY_SIMPLEX, sc, col, th, cv2.LINE_AA)
cap = cv2.VideoCapture(src); cap.set(cv2.CAP_PROP_POS_FRAMES, f0)
vw = cv2.VideoWriter(out, cv2.VideoWriter_fourcc(*'mp4v'), 59.95892, (W, H))
t = time.time(); smooth_c = None
for f in range(f0, f1):
    ok, fr = cap.read()
    if not ok: break
    o = off[f]; ax, ay = anchors[seg[f]]
    c = np.array([ax + o[0], ay + o[1] - 30])
    smooth_c = c if smooth_c is None or np.hypot(*(c - smooth_c)) > 60 else 0.8*smooth_c + 0.2*c
    cx0 = float(np.clip(smooth_c[0] - CW/2, 0, 1080 - CW)); cy0 = float(np.clip(smooth_c[1] - CH/2, 0, 1920 - CH))
    left = cv2.resize(fr, (LW, H), interpolation=cv2.INTER_AREA)
    X0, Y0 = int(cx0*2), int(cy0*2)
    right = cv2.resize(fr[Y0:Y0+int(CH*2), X0:X0+int(CW*2)], (RW, H), interpolation=cv2.INTER_CUBIC)
    kL, kR = LW/1080, RW/CW
    toL = lambda pt: (int(pt[0]*kL), int(pt[1]*kL))
    toR = lambda pt: (int((pt[0]-X0/2)*kR), int((pt[1]-Y0/2)*kR))
    cv2.rectangle(left, toL((X0/2, Y0/2)), toL((X0/2+CW, Y0/2+CH)), WHITE, 2)
    p = active(f)
    if p:
        label(right, f"PITCH {p['num']} OF {len(pit)}", (28, 52), WHITE, 1.1, 2)
        G = None
        if p['glove']:
            G = (p['Gref'][0] + o[0], p['Gref'][1] + o[1])
            gx, gy = toR(G)
            cv2.circle(right, (gx, gy), 46, GREEN, 3, cv2.LINE_AA)
            cv2.drawMarker(right, (gx, gy), GREEN, cv2.MARKER_CROSS, 120, 2, cv2.LINE_AA)
            label(right, 'TARGET (glove start)', (gx - 150, gy + 88), GREEN, .8, 2)
            cv2.circle(left, toL(G), 6, GREEN, 2, cv2.LINE_AA)
        else:
            label(right, 'Target: catcher blocked at setup, not marked', (28, 92), (200,200,200), .7, 2)
        if p['pts'][0][0] <= f <= p['catch_f']:
            trail = [(pf, (x - off[pf][0] + o[0], y - off[pf][1] + o[1])) for pf, x, y in p['pts'] if pf <= f]
            for i in range(1, len(trail)):
                cv2.line(right, toR(trail[i-1][1]), toR(trail[i][1]), YEL, 2, cv2.LINE_AA)
            if f in p['ptmap']:
                bx, by = toR(p['ptmap'][f])
                cv2.circle(right, (bx, by), 22, YEL, 3, cv2.LINE_AA)
                cv2.circle(left, toL(p['ptmap'][f]), 7, YEL, 2, cv2.LINE_AA)
                label(right, 'BALL DETECTED', (28, H - 40), YEL, 1.0, 2)
        elif f > p['catch_f']:
            C = (p['Cref'][0] + o[0], p['Cref'][1] + o[1]); cxr, cyr = toR(C)
            trail = [(x - off[pf][0] + o[0], y - off[pf][1] + o[1]) for pf, x, y in p['pts']]
            for i in range(1, len(trail)):
                cv2.line(right, toR(trail[i-1]), toR(trail[i]), YEL, 1, cv2.LINE_AA)
            cv2.drawMarker(right, (cxr, cyr), ORG, cv2.MARKER_TILTED_CROSS, 40, 3, cv2.LINE_AA)
            label(right, 'LAST BALL DETECTION', (cxr + 30, cyr - 24), ORG, .75, 2)
            if G: cv2.line(right, toR(G), (cxr, cyr), ORG, 2, cv2.LINE_AA)
            cv2.drawMarker(left, toL(C), ORG, cv2.MARKER_TILTED_CROSS, 14, 2)
    label(left, 'FULL VIEW', (16, 40), WHITE, .8, 2)
    label(right, 'ZOOM', (RW - 120, 52), WHITE, .9, 2)
    frame = np.hstack([left, right]); cv2.line(frame, (LW, 0), (LW, H), (30,30,30), 4)
    vw.write(frame)
    if f in snaps: cv2.imwrite(f'{d}/snap_{f}.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    if (f - f0) % 1500 == 0: print(f, round(time.time()-t), flush=True)
vw.release(); print('done', round(time.time()-t))

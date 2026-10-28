import cv2, numpy as np, sys, time
src, out = sys.argv[1], sys.argv[2]
c = cv2.VideoCapture(src); N = int(c.get(cv2.CAP_PROP_FRAME_COUNT))
X0,X1,Y0,Y1 = 270,702,882,1190   # catcher end of the cage, 1080x1920 frame
crop = np.lib.format.open_memmap(f'{out}/crop.npy', mode='w+', dtype=np.uint8, shape=(N,Y1-Y0,X1-X0,3))
full = np.lib.format.open_memmap(f'{out}/full.npy', mode='w+', dtype=np.uint8, shape=(N,160,90))
i=0; t=time.time()
while i < N:
    ok, fr = c.read()
    if not ok: break
    crop[i] = fr[Y0:Y1, X0:X1]
    full[i] = cv2.resize(cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY), (90,160), interpolation=cv2.INTER_AREA)
    i += 1
np.save(f'{out}/n.npy', np.array([i])); print('done', i, round(time.time()-t))

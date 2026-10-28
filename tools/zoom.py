import numpy as np, cv2, sys
d, p, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
offs = [int(x) for x in sys.argv[4].split(',')]
x0,y0,x1,y1 = [int(v) for v in sys.argv[5].split(',')]
k = int(sys.argv[6]) if len(sys.argv)>6 else 3
cr = np.load(f'{d}/crop.npy', mmap_mode='r')
tiles=[]
for o in offs:
    im = cv2.resize(cr[p+o][y0:y1,x0:x1], None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
    cv2.putText(im, f'{o:+d}', (4,18), cv2.FONT_HERSHEY_SIMPLEX, .6, (0,255,255), 2); tiles.append(im)
while len(tiles)%4: tiles.append(np.zeros_like(tiles[0]))
cv2.imwrite(out, np.vstack([np.hstack(tiles[i:i+4]) for i in range(0,len(tiles),4)]))

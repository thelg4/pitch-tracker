import numpy as np, cv2, sys
d, p, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
offs = [int(x) for x in sys.argv[4].split(',')]
cr = np.load(f'{d}/crop.npy', mmap_mode='r')
tiles = []
for o in offs:
    im = cr[p+o].copy()
    cv2.putText(im, f'{o:+d}', (6,22), cv2.FONT_HERSHEY_SIMPLEX, .7, (0,255,255), 2)
    tiles.append(im)
while len(tiles) % 4: tiles.append(np.zeros_like(tiles[0]))
rows = [np.hstack(tiles[i:i+4]) for i in range(0, len(tiles), 4)]
cv2.imwrite(out, np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 80])

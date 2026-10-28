import numpy as np, cv2, json, pickle, sys
d = sys.argv[1]
cr = np.load(f'{d}/crop.npy', mmap_mode='r')
info = json.load(open(f'{d}/info.json'))
f = int(sys.argv[2]) if len(sys.argv)>2 else info[0]['setup_f']
def blue_blobs(fr):
    hsv = cv2.cvtColor(np.ascontiguousarray(fr), cv2.COLOR_BGR2HSV)
    m = ((hsv[...,0]>100)&(hsv[...,0]<130)&(hsv[...,1]>90)&(hsv[...,2]>50)).astype(np.uint8)
    n, lab, st, cen = cv2.connectedComponentsWithStats(m)
    return [(tuple(st[k]), tuple(cen[k])) for k in range(1,n) if st[k][4] >= 20]
for x in info[:8]:
    print(x['n'], x['setup_f'], sorted([(b[0][4], b[0][:4]) for b in blue_blobs(cr[x['setup_f']])], reverse=True)[:6])

import numpy as np, sys
d = sys.argv[1]
f = np.load(f'{d}/full.npy', mmap_mode='r').astype(np.int16)
mf = np.r_[0, np.abs(np.diff(f, axis=0)).mean((1,2))]
np.save(f'{d}/mf.npy', mf)
# peaks: local max over +-90 frames, above threshold
pk = [i for i in range(90, len(mf)-90) if mf[i] > 8 and mf[i] == mf[i-90:i+91].max()]
print(len(pk)); print([(p, round(p/59.959,2), round(mf[p],1)) for p in pk])

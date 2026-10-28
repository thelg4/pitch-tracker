# Turn the detected pitches into autotags.json, the pitch queue the tracker page loads.
# usage: python 10_autotags.py DATA_DIR OUT_JSON
import json, sys
FPS = 59.95892
d, out = sys.argv[1], sys.argv[2]
info = json.load(open(f'{d}/info.json'))
drop = {2,4,6,10,13,17}                      # tracks rejected on review (foreground glove, throw to someone else)
q = []
for x in info:
    if x['n'] in drop: continue
    cx, cy = x['catch']
    q.append(dict(setup_t=round(x['setup_f']/FPS,3), catch_t=round((x['catch_f']+2)/FPS,3),
                  hint=dict(x=round(cx+270,1), y=round(cy+882,1)), est=False))
# segments between camera cuts with no clean ball track: estimate timing from the cut
for cut in (2169, 5243, 9923):
    c = cut-45
    q.append(dict(setup_t=round((c-30)/FPS,3), catch_t=round(c/FPS,3), hint=None, est=True))
q.sort(key=lambda r: r['setup_t'])
json.dump(dict(id='IMG_5997-v1', clip='IMG_5997', frame=dict(w=1080,h=1920), settings=dict(view='pitcher', fps=60), queue=q), open(out,'w'), indent=1)
print(len(q), 'pitches')

import json, collections, numpy as np
rows=json.load(open("/home/claude/capfit/data.json"))
for r in rows:
    r["years"]={int(k):v for k,v in r["years"].items()}
    r["el"]=r["len"]-r["rem"]
    r["rookie"]= r["rookieYear"]==2027-r["el"] and r["yearsPro"]<=r["len"]
def pairs(r, proj):
    out=[]
    for y,real in r["years"].items():
        if y==2027 or not real: continue
        p=proj.get(y)
        if p is None: continue
        out.append((real,p))
    return out
def score(name, model, filt=lambda r: True, verbose=False):
    errs=[]; by=collections.defaultdict(list); covered=0; missing=0
    for r in rows:
        if not filt(r): continue
        proj=model(r)
        for y,real in r["years"].items():
            if y==2027 or not real: continue
            p=proj.get(y)
            if p is None: missing+=1; continue
            e=abs(p-real)/real; errs.append(e); by[y].append(e)
    e=np.array(errs)
    print(f"{name:34} n={len(e):4d} missing={missing:3d} median {np.median(e)*100:5.1f}%  mean {e.mean()*100:5.1f}%  <=2% {np.mean(e<=0.02)*100:4.0f}%  <=5% {np.mean(e<=0.05)*100:4.0f}%  <=10% {np.mean(e<=0.10)*100:4.0f}%  >25% {np.mean(e>0.25)*100:4.0f}%")
    return e

from models import rows
import json, numpy as np, collections
LIVE=json.load(open('/home/claude/capfit/live.json'))
def key(r): return f"{r['name']}|{r['team']}"
def live(r): return {int(k):v for k,v in LIVE[key(r)]['p'].items()}
def errs(model, filt=lambda r:True):
    out=[]
    for r in rows:
        if not filt(r): continue
        p=model(r)
        for y,real in r['years'].items():
            if y==2027 or not real or y-2027>=r['rem']: continue
            out.append((r,y,real,p.get(y,0.0)))
    return out
def report(name, model, filt=lambda r:True):
    E=errs(model,filt); e=np.array([abs(p-a)/a for _,_,a,p in E]); d=np.array([abs(p-a) for _,_,a,p in E])
    tot=sum(a for _,_,a,_ in E)
    print(f"{name:28} n={len(e)} med {np.median(e)*100:.2f}% <=2% {np.mean(e<=.02)*100:.0f}% <=5% {np.mean(e<=.05)*100:.0f}% >25% {np.mean(e>.25)*100:.0f}% | $-weighted miss {d.sum()/tot*100:.1f}%")
    return E

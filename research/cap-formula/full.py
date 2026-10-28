import json, harness, numpy as np, collections
from models import rows
_a=json.load(open('/home/claude/capfit/live_full.json'))
def full(r):
    x=_a[harness.key(r)]; p={int(k):v for k,v in x['p'].items()}
    for k,v in x['d'].items(): p[int(k)]=p.get(int(k),0)+v
    return p
def allyears(f):
    num=den=0
    for r in rows:
        p=f(r)
        for y in range(2028,2032):
            v=r['years'].get(y) or 0; q=p.get(y,0); num+=abs(q-v); den+=v
    return num/den*100
def team(f):
    real=collections.defaultdict(float); pred=collections.defaultdict(float)
    for r in rows:
        if r.get('ps'): continue
        p=f(r)
        for y in range(2028,2032):
            real[(r['team'],y)]+=r['years'].get(y) or 0; pred[(r['team'],y)]+=p.get(y,0)
    by=collections.defaultdict(list); rel=[]
    for k in real: by[k[1]].append(abs(pred[k]-real[k])/1e6); rel.append(abs(pred[k]-real[k])/max(real[k],1))
    return {y:round(float(np.median(v)),1) for y,v in sorted(by.items())}, round(float(np.median(rel))*100,1)

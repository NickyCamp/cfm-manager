import json, numpy as np
from scipy.optimize import nnls
from fit import P, RK
from reqs import RATING
MT=json.load(open('mt_attrs.json'))
ALIAS={'Throw Accuracy Medium':'Medium Throw Accuracy','Throw Accuracy Short':'Short Throw Accuracy','Throw Accuracy Deep':'Deep Throw Accuracy','Throw on the Run':'Throw On The Run',
 'Run Blocking':'Run Block','Pass Blocking':'Pass Block','Lead Blocking':'Lead Block','Change of Direction':'Change Of Direction','Catch in Traffic':'Catch In Traffic','Ball Carrier Vision':'Ball Carrier Vision'}
PHYS=['speedRating','accelRating','agilityRating','changeOfDirectionRating','strengthRating','awareRating','jumpRating']
CORE={'QB':['throwPowerRating']}
GROUP={'LEDG':'EDGE','REDG':'EDGE','LG':'G','RG':'G','WILL':'OLB','SAM':'OLB'}
def feat_idx(g,arch):
    names=[RATING[ALIAS.get(a,a)] for a in MT[g][arch]]
    s=set(names+PHYS+CORE.get(g,[]))
    return [RK.index(k) for k in s]
def data(g):
    rows=[p for p in P if GROUP.get(p[3],p[3])==g]
    return rows, np.array([p[11] for p in rows],float), np.array([p[4] for p in rows],float)
def fitc(X,y,idx):
    A=np.hstack([X[:,idx]/100.0, np.ones((len(X),1)), -np.ones((len(X),1))])
    w,_=nnls(A,y); full=np.zeros(len(RK)); full[idx]=w[:-2]
    return full, w[-2]-w[-1]
def predc(c,X): return (X/100.0)@c[0]+c[1]
def fit_group(g, iters=60, seed=0):
    rows,X,y=data(g); archs=list(MT[g]); idxs=[feat_idx(g,a) for a in archs]
    rng=np.random.default_rng(seed)
    # init: each archetype fit on random half, then assign by argmax
    comps=[fitc(X[rng.random(len(y))<0.5],y[rng.random(len(y))<0.5] if False else y[:0],idx) if False else None for idx in idxs]
    lab=rng.integers(len(archs),size=len(y))
    for it in range(iters):
        comps=[fitc(X[lab==j],y[lab==j],idxs[j]) if (lab==j).sum()>=10 else fitc(X,y,idxs[j]) for j in range(len(archs))]
        Pm=np.stack([predc(c,X) for c in comps],1)
        new=Pm.argmax(1)
        if (new==lab).all(): break
        lab=new
    Pm=np.stack([predc(c,X) for c in comps],1)
    return archs, comps, Pm, X, y, rows

def pos_union(g):
    s=set(PHYS+CORE.get(g,[]))
    for a in MT[g]: s|=set(RATING[ALIAS.get(x,x)] for x in MT[g][a])
    return [RK.index(k) for k in s]
def refine(g, comps0, iters=80):
    rows,X,y=data(g); archs=list(MT[g]); idx=pos_union(g)
    Pm=np.stack([predc(c,X) for c in comps0],1); lab=Pm.argmax(1)
    comps=comps0
    for it in range(iters):
        comps=[fitc(X[lab==j],y[lab==j],idx) if (lab==j).sum()>=12 else comps[j] for j in range(len(archs))]
        Pm=np.stack([predc(c,X) for c in comps],1); new=Pm.argmax(1)
        if (new==lab).all(): break
        lab=new
    return archs, comps, Pm, X, y, rows

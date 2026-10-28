import json, numpy as np
from scipy.optimize import nnls
D=json.load(open('players.json')); RK=D['rkeys']
P=D['players']
# fields: slug,id,name,pos,best,scheme_ovr,team_scheme,scheme,dev,team,fa,ratings,slots
GROUP={'LEDG':'EDGE','REDG':'EDGE','LT':'OT','RT':'OT','LG':'G','RG':'G','WILL':'OLB','SAM':'OLB','FS':'FS','SS':'SS'}
K={'QB':4,'HB':3,'FB':2,'WR':4,'TE':3,'OT':3,'G':3,'C':3,'EDGE':3,'DT':3,'OLB':2,'MIKE':3,'CB':3,'FS':3,'SS':3}
def data(g):
    rows=[p for p in P if GROUP.get(p[3],p[3])==g]
    X=np.array([p[11] for p in rows],float); y=np.array([p[4] for p in rows],float)
    return rows,X,y
def fit_comp(X,y):
    A=np.hstack([X/100.0, np.ones((len(X),1))])  # weights on ratings + intercept (intercept can be negative: split)
    A2=np.hstack([A,-np.ones((len(X),1))])
    w,_=nnls(A2,y)
    return w
def pred(w,X):
    return (X/100.0)@w[:-2]+w[-2]-w[-1]
def maxaffine(X,y,k,iters=40,seed=0):
    rng=np.random.default_rng(seed)
    n=len(y)
    # init: kmeans on standardized ratings
    Z=(X-X.mean(0))/(X.std(0)+1e-6)
    C=Z[rng.choice(n,k,replace=False)]
    for _ in range(10):
        lab=np.argmin(((Z[:,None,:]-C[None])**2).sum(-1),1)
        C=np.array([Z[lab==j].mean(0) if (lab==j).sum()>0 else Z[rng.integers(n)] for j in range(k)])
    W=[]
    for j in range(k):
        idx=lab==j
        if idx.sum()<15: idx=rng.random(n)<0.3
        W.append(fit_comp(X[idx],y[idx]))
    for it in range(iters):
        Pm=np.stack([pred(w,X) for w in W],1)
        lab=Pm.argmax(1)
        newW=[]
        for j in range(k):
            idx=lab==j
            newW.append(fit_comp(X[idx],y[idx]) if idx.sum()>=15 else W[j])
        W=newW
    Pm=np.stack([pred(w,X) for w in W],1)
    yh=Pm.max(1)
    return W, yh, Pm

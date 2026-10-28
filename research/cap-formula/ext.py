from harness import live, LIVE, key
from models import rows
import numpy as np
CUR=2027
def ext_fit(r, step=None):
    """signed-this-season: year0 = capHit (salary only), years 1..L-1 fresh linear, bonus over min(L-1,5) from next year"""
    L=r['len']; N=L-1
    if r['el']!=0 or N<1: return None
    Pn=min(N,5); Bn=r['bonus']/Pn
    tot=r['salary']-r['capHit']; avg=tot/N
    if step is None:
        # least-squares step against video
        obs=[(k,r['years'][CUR+k]-(Bn if k-1<Pn else 0)) for k in range(1,L) if r['years'].get(CUR+k)]
        if len(obs)<2: return None
        x=np.array([k-1-(N-1)/2 for k,_ in obs]); y=np.array([v for _,v in obs])-avg
        step=float((x*y).sum()/(x*x).sum())
    s0=avg-step*(N-1)/2
    return {CUR:r['capHit'], **{CUR+k: s0+step*(k-1)+(Bn if k-1<Pn else 0) for k in range(1,L)}}, step
def err(r,p):
    return sum(abs(p.get(y,0)-v) for y,v in r['years'].items() if v and 0<y-CUR<r['rem'])

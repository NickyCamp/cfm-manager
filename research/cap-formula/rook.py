import base, numpy as np
from models import rows
CUR=2027
# templates from 2027 class (rookieYear 2028, el0, L4): salary weights
T=[]
for r in rows:
    if r['yearsPro']==0 and r['el']==0 and r['len']==4 and r['rookieYear']==2028:
        B=r['bonus']/4; s=[r['years'].get(CUR+i,0)-B for i in range(4)]
        if min(s)>0 and abs(sum(s)-r['salary'])<0.02*r['salary']: T.append((r['salary'], np.array(s)/sum(s), r['bonus']))
T.sort(key=lambda x:x[0])
def is_rookie_deal(r):
    return r['len']==4 and r['rookieYear']-1==CUR-r['el'] and r['yearsPro']<=4 and r['el']>=0
def tmpl(S, bonus):
    # nearest by salary total (rookie scale grows each year; match by rank via bonus too)
    best=min(T,key=lambda t: abs(np.log(t[0]/S))+0.5*abs(np.log((t[2]+1e5)/(bonus+1e5))))
    return best[1]
def make_rook(anchor=True):
    def f(r):
        b=base.base(r)
        if not is_rookie_deal(r) or r['rem']<2: return b
        L,el=4,r['el']; B=r['bonus']/4
        w=tmpl(r['salary'],r['bonus'])
        s_el=r['capHit']-B
        out={CUR:r['capHit']}
        for k in range(1,r['rem']):
            i=el+k
            s = s_el*w[i]/w[el] if anchor else r['salary']*w[i]
            out[CUR+k]=s+B
        return out
    return f

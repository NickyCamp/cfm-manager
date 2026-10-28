from origin import *
from base import base
from wardrule import ward
from fullmodel2 import step_rule
M=1e6
W=ward(1.05)
def make8(use_ward=True, long_rate=0.175, newbonus='minus_remreal'):
    def f(r):
        b=W(r) if use_ward else base(r)
        if r['el']!=0: return b
        k,o=origin(r)
        if k!='extended': return b
        ry=real_years(o); e=real_end(ry)
        if e is None or e<CUR: return b
        kold=e-CUR+1; N=r['len']-kold
        if N<1 or kold<1: return b
        if any(y not in ry for y in range(CUR,e+1)): return b
        gap=ry[CUR]['cap_number']*M-r['capHit']
        if abs(gap)>0.15*r['capHit']: return b
        oldsal=sum((ry[y]['cap_number']-(ry[y]['prorated_bonus'] or 0))*M for y in range(CUR,e+1))
        remreal=sum((ry[y]['prorated_bonus'] or 0)*M for y in ry if y>=CUR)
        nb = r['bonus']-remreal if newbonus=='minus_remreal' else r['bonus']
        nb=max(0,nb)
        Pn=min(N,5); Bn=nb/Pn; tot=r['salary']-oldsal
        if tot<=0: return b
        a=tot/N; d=step_rule(N,a) if N<8 else long_rate*a; s1=a-d*(N-1)/2
        out={CUR:r['capHit']}
        for kk in range(1,r['rem']):
            y=CUR+kk
            if y<=e: out[y]=ry[y]['cap_number']*M-gap
            else:
                i=y-e-1; out[y]=max(0,s1+d*i)+(Bn if i<Pn else 0)
        return out
    return f

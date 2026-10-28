from origin import *
import base as B_
from fullmodel2 import step_rule
M=1e6
def yr(N,a): return step_rule(N,a) if N<8 else 0.2*a
def make9(maxel=3, tol=0.15):
    def f(r):
        b=B_.base(r)
        el=r['el']
        if el<1 or el>maxel: return b
        k,o=origin(r)
        if k!='extended': return b
        ry=real_years(o); e=real_end(ry)
        start=CUR-el
        if e is None or e<CUR: return b
        if any(y not in ry for y in range(start,e+1)): return b
        gap=ry[CUR]['cap_number']*M-r['capHit']
        if abs(gap)>tol*r['capHit']: return b
        kold=e-start+1; N=r['len']-kold
        if N<1: return b
        oldsal=sum((ry[y]['cap_number']-(ry[y]['prorated_bonus'] or 0))*M for y in range(start,e+1))
        remreal=sum((ry[y]['prorated_bonus'] or 0)*M for y in ry if y>=start)
        nb=max(0,r['bonus']-remreal); Pn=min(N,5); Bn=nb/Pn; tot=r['salary']-oldsal
        if tot<=0: return b
        a=tot/N; d=yr(N,a); s1=a-d*(N-1)/2
        out={CUR:r['capHit']}
        for kk in range(1,r['rem']):
            y=CUR+kk
            if y<=e: out[y]=ry[y]['cap_number']*M-gap
            else: i=y-e-1; out[y]=max(0,s1+d*i)+(Bn if i<Pn else 0)
        return out
    return f

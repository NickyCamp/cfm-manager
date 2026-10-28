from extn import *
from base import base
from fullmodel2 import step_rule
CASES={}
for r,o,kold in ext_cases(): CASES[(r['name'],r['team'])]=(o,kold)
def step8(N,avg,long_rate):
    if N>=8: return long_rate*avg
    return step_rule(N,avg)
def make_ext(long_rate=0.175, kmax=1):
    def f(r):
        b=base(r); c=CASES.get((r['name'],r['team']))
        if not c: return b
        o,kold=c
        if kold>kmax: return b
        L=r['len']; N=L-kold
        oB,oP,oel26,remb=old_parts(o,kold)
        # old years: this season known; later old years: old salary unknown -> use old line (rare when kmax=1)
        s27=r['capHit']-(oB if oel26+1<oP else 0)
        newsal=r['salary']-s27; newb=max(0,r['bonus']-remb)
        Pn=min(N,5); Bn=newb/Pn; avg=newsal/N
        d=step8(N,avg,long_rate); s1=avg-d*(N-1)/2
        out={CUR:r['capHit']}
        for k in range(1,r['rem']):
            i=k-kold
            out[CUR+k]=max(0,s1+d*i)+(Bn if i<Pn else 0)
        return out
    return f

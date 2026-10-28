import base, origin
from models import rows
from harness import LIVE, key
from fullmodel2 import step_rule
CUR=2027
def yr(N,a): return step_rule(N,a) if N<8 else 0.2*a
def make_late(mode):
    def f(r):
        b=base.base(r)
        if r['el']<1 or r['bonus']<=0: return b
        k,o=origin.origin(r)
        if k not in ('nohist','unmatched','extended'): return b
        if LIVE[key(r)]['k'] not in ('extension','extension-guaranteed'): return b
        L,el,rem=r['len'],r['el'],r['rem']
        w=el  # bonus window starts this season
        P=min(L-w,5); B=r['bonus']/P
        s_el=r['capHit']-B
        if s_el<=0: return b
        N=L-w
        if mode=='slope_total':
            # salaries for years w..L-1 sum to salary minus old years (assume old years' salary ~ s_el*0.5 each)
            tot=r['salary']; n=rem
            d=(tot - n*s_el)/(n*(n-1)/2) if n>1 else 0
        else:
            d=yr(N, r['salary']/L)
        out={CUR:r['capHit']}
        for kk in range(1,rem):
            out[CUR+kk]=max(0,s_el+d*kk)+(B if kk<P else 0)
        return out
    return f

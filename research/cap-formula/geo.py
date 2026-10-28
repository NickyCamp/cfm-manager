from harness import live, LIVE, key
from models import rows
CUR=2027
def solve_g(s_el, total, L, el):
    if s_el<=0: return None
    f=lambda g: sum(s_el*g**(i-el) for i in range(L))-total
    lo,hi=0.5,2.0
    if f(lo)>0 or f(hi)<0: return None
    for _ in range(60):
        m=(lo+hi)/2
        if f(m)>0: hi=m
        else: lo=m
    return (lo+hi)/2
def make_geo(mix=1.0, only_std=True):
    def f(r):
        base=live(r)
        if only_std and LIVE[key(r)]['k']!='standard': return base
        L,el,rem=r['len'],r['el'],r['rem']
        if rem<2: return base
        P=min(L,5); B=r['bonus']/P
        s_el=r['capHit']-(B if el<P else 0)
        g=solve_g(s_el, r['salary'], L, el)
        if g is None: return base
        out={CUR:r['capHit']}
        for k in range(1,rem):
            v=s_el*g**k+(B if el+k<P else 0)
            out[CUR+k]=mix*v+(1-mix)*base.get(CUR+k,v)
        return out
    return f

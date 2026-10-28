from otc import *
from harness import live, key, LIVE
CUR=2027
def nb(s): return s['cap_number']*1e6 - (s['prorated_bonus'] or 0)*1e6
def make(rule):
    def f(r):
        base=live(r); o=match(r)
        if o is None: return base
        ry=real_years(o)
        if CUR not in ry: return base
        L,el,rem=r['len'],r['el'],r['rem']; P=min(L,5); B=r['bonus']/P
        out={}
        for k in range(1,rem):
            y=CUR+k
            if y not in ry: return base
            c=ry[y]['cap_number']*1e6; c0=ry[CUR]['cap_number']*1e6
            if rule=='R1': v=c
            elif rule=='R2': v=c+(r['capHit']-c0)
            elif rule=='R3':
                n0=nb(ry[CUR]); s_now=r['capHit']-(B if el<P else 0)
                if n0<=0: return base
                v=s_now*nb(ry[y])/n0+(B if el+k<P else 0)
            elif rule=='R4':
                v=nb(ry[y])+(B if el+k<P else 0)
            out[y]=v
        out[CUR]=r['capHit']; return out
    return f

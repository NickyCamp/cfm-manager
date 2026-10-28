from otc_rules import *
def make5(tol=0.10, shift=True, minX=0.5e6):
    def f(r):
        base=live(r); o=match(r)
        if o is None: return base
        ry=real_years(o)
        L,el,rem=r['len'],r['el'],r['rem']
        if any(CUR+k not in ry for k in range(rem)): return base
        c=lambda y: ry[y]['cap_number']*1e6
        c0=c(CUR); diff=c0-r['capHit']
        if c0<=0: return base
        P=min(L,5); n=P-el
        out={CUR:r['capHit']}
        if abs(diff)<=tol*r['capHit']:
            for k in range(1,rem): out[CUR+k]=c(CUR+k)+(diff*0 if not shift else -diff)
            return out
        if diff>minX and n>=2:
            X=diff*n/(n-1)
            for k in range(1,rem): out[CUR+k]=c(CUR+k)+(X/n if k<n else 0)
            return out
        return base
    return f

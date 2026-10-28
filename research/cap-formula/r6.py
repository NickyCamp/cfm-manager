from harness import live, key, LIVE
from models import rows
CUR=2027
def lin(s_el, salary, L, el, rem):
    denom=L*(L-1)/2-L*el
    d=(salary-L*s_el)/denom if denom else 0
    return [s_el+d*k for k in range(rem)]
def make6(minfrac=0.05, mode='orig'):
    def f(r):
        base=live(r)
        L,el,rem=r['len'],r['el'],r['rem']
        if el<1 or rem<2 or r['bonus']<=0: return base
        P=min(L,5); n=P-el
        if n<1: return base
        R=r['penalty']
        oldB=(r['bonus']-R)/el
        X=r['bonus']-oldB*P
        if oldB<0 or X<minfrac*r['bonus']: return base
        bf=oldB+X/n
        s_now=r['capHit']-bf
        if mode=='orig':
            sal=lin(s_now+X, r['salary']+X, L, el, rem); sal[0]=s_now
        else:
            sal=lin(s_now, r['salary'], L, el, rem)
        out={CUR:r['capHit']}
        for k in range(1,rem): out[CUR+k]=max(0,sal[k]+(bf if k<n else 0))
        return out
    return f

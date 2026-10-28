import base
from models import rows
from fullmodel2 import step_rule
import origin
CUR=2027
def yr(N,a): return step_rule(N,a) if N<8 else 0.2*a
def proj_w(r, w, slope='anchor'):
    """bonus window starts at contract year w (0..el); P=min(L-w,5)."""
    L,el,rem=r['len'],r['el'],r['rem']
    P=min(L-w,5); B=r['bonus']/P
    inwin=lambda i: w<=i<w+P
    s_el=r['capHit']-(B if inwin(el) else 0)
    if s_el<0: return None
    # salary line over years w..L-1 through s_el; total of those years unknown when w>0 -> use raise rule on avg of remaining
    if w==0:
        denom=L*(L-1)/2-L*el
        d=(r['salary']-L*s_el)/denom if abs(denom)>1e-9 else yr(L,r['salary']/L)
    else:
        N=L-w; d=yr(N, max(s_el,1)* (1.0))  # rough
    out={CUR:r['capHit']}
    for k in range(1,rem):
        out[CUR+k]=max(0,s_el+d*k)+(B if inwin(el+k) else 0)
    return out
def err(r,p): return sum(abs(p.get(y,0)-v) for y,v in r['years'].items() if v and 0<y-CUR<r['rem'])

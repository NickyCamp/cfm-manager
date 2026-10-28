import sys; sys.path.insert(0,"/home/claude/capfit")
from models import *
from scipy.optimize import brentq
def solve_growth(s_el, L, el, total):
    # geometric schedule through s_el at index el summing to total
    f=lambda g: sum(s_el*g**(i-el) for i in range(L))-total
    try: return brentq(f,0.3,3.0)
    except Exception: return None
def lin_future(s_el, L, el, total, rem):
    denom=L*(L-1)/2-L*el
    d=(total-L*s_el)/denom if denom else 0
    return [s_el+d*k for k in range(1,rem)]
def geo_future(s_el,L,el,total,rem):
    g=solve_growth(s_el,L,el,total)
    if g is None: return lin_future(s_el,L,el,total,rem)
    return [s_el*g**k for k in range(1,rem)]

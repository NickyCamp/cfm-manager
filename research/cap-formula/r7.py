from origin import *
from r5 import make5
from harness import live
from fullmodel2 import step_rule
M=1e6
R5=make5(0.1,True)
def gen_new(total_sal, bonus, N, step_scale=1.0):
    Pn=min(N,5); Bn=bonus/Pn; avg=total_sal/N
    d=step_rule(N,avg)*step_scale; s0=avg-d*(N-1)/2
    return [max(0,s0+d*i)+(Bn if i<Pn else 0) for i in range(N)]
def make7(step_scale=1.0, oldmode='cap'):
    def f(r):
        k,o=origin(r)
        if k in ('real','real-restructured'): return R5(r)
        if k!='extended': return live(r)
        ry=real_years(o); e=real_end(ry); ms=CUR-r['el']
        kold=e-ms+1; N=r['len']-kold
        if N<1: return live(r)
        oldsal=sum((ry[y]['cap_number']-(ry[y]['prorated_bonus'] or 0))*M for y in range(ms,e+1) if y in ry)
        if CUR<=e and CUR in ry:  # replace current year salary with Madden's actual
            pass
        new=gen_new(r['salary']-oldsal, r['bonus'], N, step_scale)
        out={CUR:r['capHit']}
        for kk in range(1,r['rem']):
            y=CUR+kk
            if y<=e: out[y]=ry[y]['cap_number']*M if y in ry else 0
            else: out[y]=new[y-e-1]
        return out
    return f

from base import base
from fullmodel2 import step_rule
from models import rows
CUR=2027
def is_rookie(r): return r['yearsPro']<=3 and r['rookieYear']-1==CUR-r['el']
def ward(thresh=1.05, long_rate=0.175):
    def f(r):
        b=base(r)
        L=r['len']
        if r['el']!=0 or L<3 or is_rookie(r): return b
        P=min(L,5); B=r['bonus']/P; avg=r['salary']/L
        if avg<=0 or (r['capHit']-B)/avg<=thresh: return b
        N=L-1; Pn=min(N,5); Bn=r['bonus']/Pn
        tot=r['salary']-r['capHit']
        if tot<=0: return b
        a=tot/N; d=step_rule(N,a) if N<8 else long_rate*a; s1=a-d*(N-1)/2
        out={CUR:r['capHit']}
        for k in range(1,r['rem']): out[CUR+k]=max(0,s1+d*(k-1))+(Bn if k-1<Pn else 0)
        return out
    return f

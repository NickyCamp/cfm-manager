import sys; sys.path.insert(0,"/home/claude/capfit")
from models import *
CUR=2027
def s0_rule(N, avg, bpy):
    # first-year salary of a brand-new Madden deal (fit on in-franchise signings)
    if N<=1: return avg
    if N==2:
        if avg<1.7e6: return 0.97*avg
        return max(0.4*avg, 0.9494*avg-0.3738*bpy+21500)
    if N==3: return 0.3627*avg+870400
    return 0.4260*avg+625000 if avg<6e6 else 0.4260*avg+625000
def lin_from_s0(s0, N, total):
    d=(total-N*s0)/(N*(N-1)/2) if N>1 else 0
    return [s0+d*i for i in range(N)]
def classify(r):
    L,el,rem=r["len"],r["el"],r["rem"]; P=min(L,5); B=r["bonus"]/P if P else 0
    excess=r["penalty"]-B*max(0,P-el)
    thr=max(80000,0.01*r["bonus"])
    if el==0 and excess>thr and r["bonus"]>0 and r["capHit"]<0.9*B: return "pending_ext"
    return "standard"
def old_years_left(r):
    yrs_in=CUR-r["rookieYear"]
    if 0<=yrs_in<4 and r["yearsPro"]<=4: return max(1,4-yrs_in)
    return 1
def model(r, opts={}):
    L,el,rem=r["len"],r["el"],r["rem"]
    if rem<=1: return {}
    kind=classify(r)
    if kind=="standard":
        P=min(L,5); B=r["bonus"]/P
        s_el=r["capHit"]-(B if el<P else 0)
        denom=L*(L-1)/2-L*el
        d=(r["salary"]-L*s_el)/denom if denom else 0
        return {CUR+k: s_el+d*k+(B if el+k<P else 0) for k in range(1,rem)}
    # pending extension
    k_old=min(old_years_left(r), L-1)
    N=L-k_old; Pn=min(N,5); Bn=r["bonus"]/Pn
    g=opts.get("old_growth",1.10)
    old=[r["capHit"]*g**j for j in range(k_old)]
    new_total=r["salary"]-sum(old)
    avg=new_total/N
    s0=s0_rule(N,avg,Bn)
    sal=lin_from_s0(s0,N,new_total)
    out={}
    for k in range(1,rem):
        if k<k_old: out[CUR+k]=old[k]
        else:
            i=k-k_old; out[CUR+k]=sal[i]+(Bn if i<Pn else 0)
    return out

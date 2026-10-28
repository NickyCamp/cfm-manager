import sys; sys.path.insert(0,"/home/claude/capfit")
from models import *
CUR=2027
def s0_rule(N, avg, bpy):
    if N<=1: return avg
    if N==2:
        if avg<1.7e6: return 0.97*avg
        return max(0.4*avg, 0.9494*avg-0.3738*bpy+21500)
    if N==3: return 0.3627*avg+870400
    return 0.4260*avg+625000
def lin_from_s0(s0,N,total):
    d=(total-N*s0)/(N*(N-1)/2) if N>1 else 0
    return [s0+d*i for i in range(N)]
def old_years_left(r):
    yrs_in=CUR-r["rookieYear"]
    if 0<=yrs_in<4 and r["yearsPro"]<=4: return max(1,4-yrs_in)
    return 1
def classify(r):
    L,el=r["len"],r["el"]; P=min(L,5); B=r["bonus"]/P if P else 0
    if el==0 and r["bonus"]>0 and r["capHit"]<0.9*B and L>=2: return "pending_ext"
    excess=r["penalty"]-B*max(0,P-el)
    if excess>max(80000,0.01*r["bonus"]): return "excess"
    return "standard"
def anchored(r,B,P,el=None,L=None,total=None):
    L=L or r["len"]; el=r["el"] if el is None else el; rem=r["rem"]; total=r["salary"] if total is None else total
    s_el=r["capHit"]-(B if el<P else 0)
    denom=L*(L-1)/2-L*el
    d=(total-L*s_el)/denom if denom else 0
    return {CUR+k: s_el+d*k+(B if el+k<P else 0) for k in range(1,rem)}
def model(r, variant="A"):
    L,el,rem=r["len"],r["el"],r["rem"]
    if rem<=1: return {}
    kind=classify(r)
    if kind=="pending_ext":
        k_old=min(old_years_left(r),L-1); N=L-k_old; Pn=min(N,5); Bn=r["bonus"]/Pn
        old=[r["capHit"]*1.10**j for j in range(k_old)]
        new_total=r["salary"]-sum(old); avg=new_total/N
        sal=lin_from_s0(s0_rule(N,avg,Bn),N,new_total)
        return {CUR+k:(old[k] if k<k_old else sal[k-k_old]+(Bn if k-k_old<Pn else 0)) for k in range(1,rem)}
    P=min(L,5); B=r["bonus"]/P
    if kind=="excess" and variant!="A":
        if variant=="B":   # spread remaining dead money evenly over remaining bonus years
            n=max(1,min(rem,P-el if P-el>0 else 1)); b=r["penalty"]/n
            s_el=r["capHit"]-b
            denom=L*(L-1)/2-L*el; d=(r["salary"]-L*s_el)/denom if denom else 0
            return {CUR+k: s_el+d*k+(b if k<n else 0) for k in range(1,rem)}
        if variant=="C":   # keep standard bonus share; treat extra dead money as old money ending this season
            return anchored(r,B,P)
        if variant=="D":   # remaining salary only: line through s_el, remaining sum = salary*rem/L
            s_el=r["capHit"]-(B if el<P else 0)
            rem_total=r["salary"]*rem/L
            d=(rem_total-rem*s_el)/(rem*(rem-1)/2) if rem>1 else 0
            return {CUR+k: s_el+d*k+(B if el+k<P else 0) for k in range(1,rem)}
    return anchored(r,B,P)

def inv_avg(N, s0, bpy):
    # invert s0_rule for the average salary of an N-year deal
    if N<=1: return s0
    if N==2:
        if s0<0.97*1.7e6: return s0/0.97
        return (s0+0.3738*bpy-21500)/0.9494
    if N==3: return (s0-870400)/0.3627
    return (s0-625000)/0.4260
def model_E(r, k_old=1, use_total=False):
    L,el,rem=r["len"],r["el"],r["rem"]
    if rem<=1: return {}
    if classify(r)!="excess" or el<1: return model(r)
    N=L-k_old
    if N<2: return model(r)
    Pn=min(N,5); Bn=r["bonus"]/Pn
    j=el-k_old              # index of the current year inside the new deal
    if j<0: return model(r)
    s_now=r["capHit"]-(Bn if j<Pn else 0)
    if use_total:
        # salary before the new deal: k_old old years, unknown; assume old salary ~ current/1.5
        new_total=r["salary"]-k_old*max(0.0,s_now/1.5)
        denom=N*(N-1)/2-N*j
        d=(new_total-N*s_now)/denom if denom else 0
    else:
        s0_new=s_now if j==0 else None
        if j==0:
            avg=inv_avg(N,s_now,Bn); d=2*(avg-s_now)/(N-1)
        else:
            denom=N*(N-1)/2-N*j; d=(r["salary"]-N*s_now)/denom if denom else 0
    return {CUR+k: s_now+d*k+(Bn if j+k<Pn else 0) for k in range(1,rem)}

def model_G(r, frac=0.95, rule="line"):
    L,el,rem=r["len"],r["el"],r["rem"]
    if rem<=1: return {}
    kind=classify(r)
    if kind!="excess": return model(r)
    P=min(L,5); B=r["bonus"]/P
    R_bonus=B*max(0,P-el)
    G=r["penalty"]-R_bonus
    s_now=r["capHit"]-(B if el<P else 0)
    if G < frac*s_now*rem:       # not fully guaranteed: no remaining-salary info
        return model(r)
    fut=G-s_now                  # salary still to come after this season
    n=rem-1
    d=(fut-n*s_now)/(n*(n+1)/2)
    return {CUR+k: s_now+d*k+(B if el+k<P else 0) for k in range(1,rem)}

def model_G2(r, mode="fresh"):
    L,el,rem=r["len"],r["el"],r["rem"]
    if rem<=1: return {}
    if classify(r)!="excess": return model(r)
    P=min(L,5); B=r["bonus"]/P
    G=r["penalty"]-B*max(0,P-el)
    s_now=r["capHit"]-(B if el<P else 0)
    if G<0.95*s_now*rem: return model(r)
    fut=G-s_now; n=rem-1
    line_d=(fut-n*s_now)/(n*(n+1)/2)
    line=[s_now+line_d*k for k in range(1,rem)]
    if n>=2:
        avg=fut/n; f0=s0_rule(n,avg,B); fresh=lin_from_s0(f0,n,fut)
    else: fresh=[fut]
    if mode=="fresh": sal=fresh
    elif mode=="blend": sal=[(a+b)/2 for a,b in zip(line,fresh)]
    else: sal=line
    return {CUR+k: sal[k-1]+(B if el+k<P else 0) for k in range(1,rem)}

STEP_FIT={2:(0.5801,-352500),3:(0.6136,-662900),4:(0.3593,-387300),5:(0.3065,-395100),6:(0.3065,-395100),7:(0.2593,-460900)}
def step_rule(N,avg):
    if N<=1: return 0.0
    a,c=STEP_FIT.get(N,(0.175,0.0))
    return max(0.0,a*avg+c)
def model_P(r):
    L,el,rem=r["len"],r["el"],r["rem"]
    if rem<=1: return {}
    if classify(r)!="pending_ext": return model_G(r)
    k_old=min(old_years_left(r),L-1); N=L-k_old; Pn=min(N,5); Bn=r["bonus"]/Pn
    old=[r["capHit"]*1.10**j for j in range(k_old)]
    new_total=r["salary"]-sum(old); avg=new_total/N
    d=step_rule(N,avg); s0=avg-d*(N-1)/2
    sal=[s0+d*i for i in range(N)]
    return {CUR+k:(old[k] if k<k_old else sal[k-k_old]+(Bn if k-k_old<Pn else 0)) for k in range(1,rem)}

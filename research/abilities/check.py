import pickle, numpy as np, collections, sys
from cfit import P, RK, predc, GROUP
from reqs import rules
FITS=pickle.load(open(sys.argv[1] if len(sys.argv)>1 else 'rfits.pkl','rb'))
RS=rules(); BY_TITLE={e['title'].lower():e for e in RS.values()}
NAME={'Manto Man':'Man'}
def arch_scores(p):
    g=GROUP.get(p[3],p[3])
    if g not in FITS: return {}
    archs,comps=FITS[g]; X=np.array(p[11],float)[None]
    return {a:float(predc(c,X)[0]) for a,c in zip(archs,comps)}
def check():
    res=collections.defaultdict(list); fails=[]
    for p in P:
        sc=arch_scores(p)
        for thr,locked,empty,title,rank in p[12]:
            e=BY_TITLE.get(title.lower()) if title else None
            if not e: continue
            for gr in e['groups']:
                if gr['tier'] not in ('Bronze','Single') or p[3] not in gr['pos']: continue
                for typ,name,val in gr['reqs']:
                    if typ!='arch': continue
                    nm=NAME.get(name,name)
                    if nm not in sc: res[('missing',name)].append(0); continue
                    ok=round(sc[nm])>=val
                    res[(GROUP.get(p[3],p[3]),name)].append(ok)
                    if not ok: fails.append((p[2],p[3],p[4],title,name,val,round(sc[nm],1),{k:round(v) for k,v in sc.items()}))
    return res,fails
if __name__=='__main__':
    res,fails=check()
    tot=sum(len(v) for v in res.values()); ok=sum(sum(v) for v in res.values())
    print(f'overall holders meeting archetype bar: {ok}/{tot} = {ok/tot*100:.1f}%')
    for k,v in sorted(res.items()): print(f"  {k[0]:5} {k[1]:16} {sum(v)}/{len(v)}")
    for f in fails[:25]: print(f)

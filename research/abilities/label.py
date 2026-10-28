import pickle, numpy as np, json, collections, itertools
from fit import P, RK, pred
from reqs import rules
GROUP={'LEDG':'EDGE','REDG':'EDGE','LT':'LT','RT':'RT','LG':'G','RG':'G','WILL':'OLB','SAM':'OLB'}
fits=pickle.load(open('fits.pkl','rb'))
RS=rules(); BY_TITLE={e['title'].lower():e for e in RS.values()}
def evidence():
    ev=collections.defaultdict(lambda: collections.defaultdict(list))  # (group, arch) -> comp -> list of pass
    for p in P:
        pos=p[3]; g=GROUP.get(pos,pos)
        if g not in fits: continue
        X=np.array(p[11],float)[None]
        comps=[pred(w,X)[0] for w in fits[g]]
        for thr,locked,empty,title,rank in p[12]:
            if not title: continue
            e=BY_TITLE.get(title.lower())
            if not e: continue
            for gr in e['groups']:
                if gr['tier'] not in ('Bronze','Single') or pos not in gr['pos']: continue
                for typ,name,val in gr['reqs']:
                    if typ!='arch' or val is None: continue
                    for j,c in enumerate(comps): ev[(g,name)][j].append(round(c)>=val)
    return ev
if __name__=='__main__':
    ev=evidence()
    for (g,name),d in sorted(ev.items()):
        print(f"{g:5} {name:16} n={len(d[0]):3} " + '  '.join(f"c{j}:{np.mean(v)*100:5.1f}%" for j,v in sorted(d.items())))

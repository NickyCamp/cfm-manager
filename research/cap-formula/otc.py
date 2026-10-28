import pandas as pd, re, unicodedata, numpy as np
from models import rows
df=pd.read_parquet('/home/claude/capfit/hc.parquet')
df=df[df.is_active==True]
def norm(s):
    s=unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower()
    s=re.sub(r'\b(jr|sr|ii|iii|iv|v)\b','',s); s=re.sub(r'[^a-z ]',' ',s)
    return ' '.join(s.split())
idx={}
for _,r in df.iterrows():
    n=norm(r.player).split()
    if not n: continue
    idx.setdefault((n[0][0], n[-1]),[]).append(r)
POS={'LT':'T','RT':'T','LG':'G','RG':'G','C':'C','LEDG':'ED','REDG':'ED','MIKE':'LB','WILL':'LB','SAM':'LB','SS':'S','FS':'S'}
def match(r):
    nm=r['name']
    if '.' in nm and ' ' not in nm.split('.')[0]:
        f,l=nm.split('.',1); key=(f.strip().lower()[0], norm(l).split()[-1] if norm(l) else '')
    else:
        n=norm(nm).split(); key=(n[0][0], n[-1])
    c=idx.get(key,[])
    if len(c)>1:
        c2=[x for x in c if x.draft_year==r['rookieYear'] or abs((x.draft_year or 0)-r['rookieYear'])<=1]
        c=c2 or c
    return c[0] if len(c)==1 else None
def real_years(o):
    out={}
    for s in o.season_history:
        try: y=int(s['year'])
        except: continue
        out[y]=s
    return out

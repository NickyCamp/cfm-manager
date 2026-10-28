import json, re, unicodedata
from models import rows
old=json.load(open('/home/claude/ncl-sync/site/old_data.json'))['players']
def norm(s):
    s=unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower()
    s=re.sub(r'\b(jr|sr|ii|iii|iv|v)\b','',s); s=re.sub(r'[^a-z ]',' ',s); return ' '.join(s.split())
idx={}
for p in old:
    n=norm(p['last_name']).split()
    if not n: continue
    idx.setdefault((norm(p['first_name'])[:1], n[-1]),[]).append(p)
def old_of(r):
    nm=r['name']
    m=re.match(r'^([^.\s]+)\.(.+)$',nm)
    if m: f,l=m.group(1),m.group(2)
    else: parts=nm.split(' '); f,l=parts[0],' '.join(parts[1:])
    ln=norm(l).split()
    if not ln: return None
    c=idx.get((norm(f)[:1],ln[-1]),[])
    if len(c)>1: c=[p for p in c if abs(p['age']-(r['age']-1))<=1] or c
    if len(c)>1: c=[p for p in c if p['years_pro']==r['yearsPro']-1] or c
    return c[0] if len(c)==1 else None

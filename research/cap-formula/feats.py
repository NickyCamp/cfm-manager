from ext import *
POSG={'QB':'QB','HB':'RB','FB':'RB','WR':'WR','TE':'TE','LT':'OL','LG':'OL','C':'OL','RG':'OL','RT':'OL','LEDG':'DL','REDG':'DL','DT':'DL','MIKE':'LB','WILL':'LB','SAM':'LB','CB':'DB','FS':'DB','SS':'DB','K':'ST','P':'ST','LS':'ST'}
def feats(r):
    L=r['len']; P=min(L,5); B=r['bonus']/P if P else 0; avg=r['salary']/L
    return dict(
        capB=r['capHit']/B if B else 9, z=(r['capHit']-B)/avg if avg else 0, capAvg=r['capHit']/((r['salary']+r['bonus'])/L),
        penb=(r['penalty']-r['bonus'])/max(r['capHit'],1), sav=r['savings']/max(r['capHit'],1), bonfrac=r['bonus']/(r['salary']+r['bonus']+1),
        L=L, age=r['age'], ovr=r['ovr'], dev=r['dev'], yp=r['yearsPro'], rd=r['draftRound'], apy=(r['salary']+r['bonus'])/L/1e6,
        dsal=r.get('desiredSalary',0)/1e6, dlen=r.get('desiredLength',0), resign=r.get('reSign',0), pos=POSG.get(r['pos'],'X'))

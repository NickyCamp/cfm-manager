from otc import *
CUR=2027
def real_end(ry):
    y=2026
    if y not in ry or not (ry[y]['cash_paid'] or 0)>0: 
        ys=[y for y,s in ry.items() if (s['cash_paid'] or 0)>0 and (s['cap_number'] or 0)>0.3]
        return max(ys) if ys else None
    while y+1 in ry and (ry[y+1]['cash_paid'] or 0)>0 and (ry[y+1]['cap_number'] or 0)>0.3: y+=1
    return y
def origin(r):
    o=match(r)
    if o is None: return 'unmatched', None
    ry=real_years(o); e=real_end(ry)
    if e is None or CUR not in ry: return 'nohist', o
    m_end=CUR+r['rem']-1; m_start=CUR-r['el']
    c0=ry[CUR]['cap_number']*1e6
    if e==m_end:
        if abs(c0-r['capHit'])<=0.1*r['capHit']: return 'real', o
        if c0>r['capHit']: return 'real-restructured', o
        return 'real-other', o
    if e<m_end:
        return ('extended' if e>=CUR else 'new-after-real'), o
    return 'shorter', o

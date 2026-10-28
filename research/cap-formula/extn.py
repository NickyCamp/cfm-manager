from snap import *
import numpy as np
CUR=2027
def ext_cases():
    out=[]
    for r in rows:
        o=old_of(r)
        if o is None or r['el']!=0: continue
        same = o['contract_length']==r['len'] and abs(o['contract_salary']-r['salary'])<1e4 and abs(o['contract_bonus']-r['bonus'])<1e4
        if same: continue
        kold=o['contract_years_left']-1
        if kold<1 or r['len']-kold<2: continue
        out.append((r,o,kold))
    return out
def old_parts(o, kold):
    oL=o['contract_length']; oel26=oL-o['contract_years_left']
    oP=min(oL,5); oB=o['contract_bonus']/oP
    # bonus charged through 2026 (incl 2026 share)
    charged=oB*min(oel26+1,oP)
    rem_bonus=o['contract_bonus']-charged
    return oB, oP, oel26, rem_bonus

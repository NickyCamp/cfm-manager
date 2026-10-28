import json, re
R=json.load(open('ms_req.json'))
POSMAP={'Quarterbacks':['QB'],'Halfbacks':['HB'],'Fullbacks':['FB'],'Wide Receivers':['WR'],'Tight Ends':['TE'],'Offensive Tackles':['LT','RT'],
 'Offensive Guards':['LG','RG'],'Centers':['C'],'Edges':['LEDG','REDG'],'Defensive Tackles':['DT'],'Mike Linebackers':['MIKE'],
 'Outside Linebackers':['WILL','SAM'],'Cornerbacks':['CB'],'Safeties':['FS','SS'],'Kickers':['K'],'Punters':['P'],'Kickers/Punters':['K','P']}
RATING={'Overall':'OVR','Tackle':'tackleRating','Awareness':'awareRating','Strength':'strengthRating','Stamina':'staminaRating','Block Shedding':'blockShedRating',
 'Speed':'speedRating','Acceleration':'accelRating','Man Coverage':'manCoverRating','Change Of Direction':'changeOfDirectionRating','Zone Coverage':'zoneCoverRating',
 'Agility':'agilityRating','Hit Power':'hitPowerRating','Break Tackle':'breakTackleRating','Short Route Running':'routeRunShortRating','Trucking':'truckRating',
 'Power Moves':'powerMovesRating','Finesse Moves':'finesseMovesRating','Play Recognition':'playRecRating','Medium Throw Accuracy':'throwAccMidRating','Carrying':'carryRating',
 'Pursuit':'pursuitRating','Juke Move':'jukeMoveRating','Spin Move':'spinMoveRating','Run Block':'runBlockRating','Toughness':'toughRating','Pass Block':'passBlockRating',
 'Stiff Arm':'stiffArmRating','Medium Route Running':'routeRunMedRating','Impact Blocking':'impactBlockRating','Catch In Traffic':'cITRating','Throw Under Pressure':'throwUnderPressureRating',
 'Pass Block Finesse':'passBlockFinesseRating','Jumping':'jumpRating','Play Action':'playActionRating','Throw Power':'throwPowerRating','Short Throw Accuracy':'throwAccShortRating',
 'Deep Throw Accuracy':'throwAccDeepRating','Deep Route Running':'routeRunDeepRating','Spectacular Catch':'specCatchRating','Catching':'catchRating','Pass Block Power':'passBlockPowerRating',
 'Run Block Finesse':'runBlockFinesseRating','Run Block Power':'runBlockPowerRating','Kick Power':'kickPowerRating','Break Sack':'breakSackRating','Release':'releaseRating',
 'Throw On The Run':'throwOnRunRating','Kick Accuracy':'kickAccRating','Lead Block':'leadBlockRating','Press':'pressRating','Ball Carrier Vision':'bCVRating','Kick Return':'kickRetRating',
 'Throw Accuracy':'throwAccRating','Injury':'injuryRating','Long Snap':'longSnapRating'}
def parse_val(v):
    m=re.match(r'(\d+) or higher',v or '')
    return int(m.group(1)) if m else None
def parse_slots(v):
    m=re.match(r'Slots? (\d+)(?: (?:to|or) (\d+))?',v or '')
    if not m: return None
    a=int(m.group(1)); b=int(m.group(2) or a)
    return list(range(a,b+1)) if ' to ' in v else sorted({a,b})
def rules():
    out={}
    for slug,x in R.items():
        if x.get('err') or not x.get('title'): continue
        if x['title'].startswith('Madden 27 Abilities'): continue
        entry={'slug':slug,'title':x['title'],'kind':x['kind'],'groups':[]}
        gs=x['groups'] or ([{'group':'','tiers':[{'tier':'','rows':x['flat']}]}] if x.get('flat') else [])
        for g in gs:
            for t in g['tiers']:
                pos=[];reqs=[];slots=None;unknown=[]
                for k,v in t['rows']:
                    if k=='Position':
                        for nm in [s.strip() for s in re.split(r',| and ', v) if s.strip()]:
                            if nm in POSMAP: pos+=POSMAP[nm]
                            else: unknown.append(('pos',nm))
                    elif k=='Ability slot': slots=parse_slots(v)
                    elif k.endswith(' rating'): reqs.append(('arch',k[:-7].strip(),parse_val(v)))
                    elif k in RATING: reqs.append(('rating',RATING[k],parse_val(v)))
                    else: unknown.append((k,v))
                entry['groups'].append({'tier':t['tier'] or 'Single','pos':pos,'slots':slots,'reqs':reqs,'unknown':unknown})
        out[slug]=entry
    return out
if __name__=='__main__':
    import collections
    rs=rules(); unk=collections.Counter()
    for e in rs.values():
        for g in e['groups']:
            for u in g['unknown']: unk[str(u)]+=1
    print(len(rs), 'unknown labels:', unk.most_common(20))
    print(json.dumps(rs['edge-threat'],indent=0)[:800])
    arch=collections.Counter((p,r[1]) for e in rs.values() for g in e['groups'] for r in g['reqs'] if r[0]=='arch' for p in g['pos'])
    print(sorted(arch))

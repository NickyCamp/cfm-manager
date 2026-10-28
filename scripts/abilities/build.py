"""Builds src/lib/league/abilities-data.json (and archetypes.json next to it).

Inputs in scripts/abilities/input/, captured 2026-10-28 from public pages:
- ms_req.json: franchise requirements per ability and tier, from Madden School
  (madden-school.com/abilities/<slug>/): positions, ability slots, overall /
  archetype / rating minimums.
- ct.json: mechanics per ability, from ClutchTrait Abilities
  (abilities.clutchtrait.com/abilities/<slug>): Madden's trigger, effect and
  shutdown identifiers.
- mt_attrs.json: each archetype's key ratings (madden.tools), used to label the
  archetype formulas.
- archetypes.json: archetype score formulas fit to EA's ratings (see below).

Only facts are kept (identifiers, positions, numbers). Descriptions stay on the
source sites; the app links to them.

Archetype formulas: Madden doesn't export archetype scores (e.g. "Speed Rusher
90+"), only each player's best overall. Fit on 5,476 players from two Madden 27
leagues: a player's overall = his best archetype's score, each archetype a
non-negative weighted sum of ratings. Reproduces overall exactly for 90-98% of
players at most positions; 93% of current ability holders clear their
archetype minimum. Treat calls within a point of a cutoff as borderline.
"""
import json, re, collections, os

HERE = os.path.dirname(__file__)
IN = os.path.join(HERE, "input")
OUT = os.path.join(HERE, "..", "..", "src", "lib", "league")

ms = json.load(open(os.path.join(IN, "ms_req.json")))
ct = json.load(open(os.path.join(IN, "ct.json")))

POSMAP = {'Quarterbacks': ['QB'], 'Halfbacks': ['HB'], 'Fullbacks': ['FB'], 'Wide Receivers': ['WR'], 'Tight Ends': ['TE'],
          'Offensive Tackles': ['LT', 'RT'], 'Offensive Guards': ['LG', 'RG'], 'Centers': ['C'], 'Edges': ['LEDG', 'REDG'],
          'Defensive Tackles': ['DT'], 'Mike Linebackers': ['MIKE'], 'Outside Linebackers': ['WILL', 'SAM'], 'Cornerbacks': ['CB'],
          'Safeties': ['FS', 'SS'], 'Kickers': ['K'], 'Punters': ['P'], 'Kickers/Punters': ['K', 'P']}
OFFENSE = {'QB', 'HB', 'FB', 'WR', 'TE', 'LT', 'RT', 'LG', 'RG', 'C'}
RATING = {'Overall': 'OVR', 'Tackle': 'tackleRating', 'Awareness': 'awareRating', 'Strength': 'strengthRating', 'Stamina': 'staminaRating',
          'Block Shedding': 'blockShedRating', 'Speed': 'speedRating', 'Acceleration': 'accelRating', 'Man Coverage': 'manCoverRating',
          'Change Of Direction': 'changeOfDirectionRating', 'Zone Coverage': 'zoneCoverRating', 'Agility': 'agilityRating', 'Hit Power': 'hitPowerRating',
          'Break Tackle': 'breakTackleRating', 'Short Route Running': 'routeRunShortRating', 'Trucking': 'truckRating', 'Power Moves': 'powerMovesRating',
          'Finesse Moves': 'finesseMovesRating', 'Play Recognition': 'playRecRating', 'Medium Throw Accuracy': 'throwAccMidRating', 'Carrying': 'carryRating',
          'Pursuit': 'pursuitRating', 'Juke Move': 'jukeMoveRating', 'Spin Move': 'spinMoveRating', 'Run Block': 'runBlockRating', 'Toughness': 'toughRating',
          'Pass Block': 'passBlockRating', 'Stiff Arm': 'stiffArmRating', 'Medium Route Running': 'routeRunMedRating', 'Impact Blocking': 'impactBlockRating',
          'Catch In Traffic': 'cITRating', 'Throw Under Pressure': 'throwUnderPressureRating', 'Pass Block Finesse': 'passBlockFinesseRating',
          'Jumping': 'jumpRating', 'Play Action': 'playActionRating', 'Throw Power': 'throwPowerRating', 'Short Throw Accuracy': 'throwAccShortRating',
          'Deep Throw Accuracy': 'throwAccDeepRating', 'Deep Route Running': 'routeRunDeepRating', 'Spectacular Catch': 'specCatchRating',
          'Catching': 'catchRating', 'Pass Block Power': 'passBlockPowerRating', 'Run Block Finesse': 'runBlockFinesseRating',
          'Run Block Power': 'runBlockPowerRating', 'Kick Power': 'kickPowerRating', 'Break Sack': 'breakSackRating', 'Release': 'releaseRating',
          'Throw On The Run': 'throwOnRunRating', 'Kick Accuracy': 'kickAccRating', 'Lead Block': 'leadBlockRating', 'Press': 'pressRating',
          'Ball Carrier Vision': 'bCVRating', 'Kick Return': 'kickRetRating', 'Throw Accuracy': 'throwAccRating', 'Long Snap': 'longSnapRating'}
ARCH_NAME = {'Manto Man': 'Man'}

def norm(t): return re.sub(r'[^a-z0-9]', '', t.lower())

def val(v):
    m = re.match(r'(\d+) or higher', v or '')
    return int(m.group(1)) if m else None

def slots(v):
    m = re.match(r'Slots? (\d+)(?: (to|or) (\d+))?', v or '')
    if not m: return None
    a, b = int(m.group(1)), int(m.group(3) or m.group(1))
    return list(range(a, b + 1)) if m.group(2) == 'to' else sorted({a, b})

abilities = {}
problems = []
for slug, x in ms.items():
    t = x.get('title') or ''
    if not t or t.startswith('Madden 27 Abilities'):
        continue
    if x.get('missing'):
        continue
    tiers = []
    for tr in x.get('tiers', []):
        pos, reqs, sl = [], [], None
        for k, v in tr['rows']:
            if k == 'Position':
                for nm in [s.strip() for s in re.split(r',| and ', v) if s.strip()]:
                    if nm in POSMAP: pos += POSMAP[nm]
                    else: problems.append((slug, 'pos', nm))
            elif k == 'Ability slot': sl = slots(v)
            elif k.endswith(' rating'):
                n = k[:-7].strip(); reqs.append(['arch', ARCH_NAME.get(n, n), val(v)])
            elif k in RATING: reqs.append(['ovr' if RATING[k] == 'OVR' else 'rating', RATING[k], val(v)])
            else: problems.append((slug, k, v))
        tier = tr['tier'] if tr['tier'] in ('Bronze', 'Silver', 'Gold') else 'Single'
        tiers.append({'tier': tier, 'pos': pos, 'slots': sl, 'reqs': reqs})
    abilities[norm(t)] = {'title': t, 'kind': x.get('kind') or '', 'ms': slug, 'tiers': tiers}

for slug, x in ct.items():
    t = x.get('title') or ''
    k = norm(t)
    a = abilities.setdefault(k, {'title': t, 'kind': 'X-Factor' if x.get('xfactor') else 'Superstar', 'ms': None, 'tiers': []})
    a['ct'] = slug
    a['triggers'] = [m['id'] for m in x['triggers']]
    a['effects'] = [m['id'] for m in x['effects']]
    a['stops'] = [m['id'] for m in x['stops']]
    a['multiTier'] = bool(x.get('hasSilver'))

def side(a):
    ps = {p for t in a['tiers'] for p in t['pos']}
    if ps:
        off = len(ps & OFFENSE); return 'offense' if off >= len(ps) - off else 'defense'
    effs = ' '.join(a.get('effects', []))
    return 'defense' if re.search(r'Def(_|\b)|^Defense|Tackle_', effs) else 'offense'

for a in abilities.values():
    a['side'] = side(a)

# Shared mechanics: abilities that change the same in-game effect.
by_effect = collections.defaultdict(set)
for k, a in abilities.items():
    for e in a.get('effects', []): by_effect[e].add(k)
for k, a in abilities.items():
    shared = collections.Counter()
    for e in a.get('effects', []):
        for o in by_effect[e]:
            if o != k: shared[o] += 1
    a['overlaps'] = [o for o, _ in shared.most_common()]

# Head-to-head: one ability raises the defense's chance to win an interaction,
# another raises the offense's chance on the same one (DefWin vs OffWin, or a
# Def-prefixed effect vs its offensive twin), on opposite sides of the ball.
def matchup_key(e):
    p = e.split('_'); fam = re.sub(r'(Off|Def)$', '', p[0]); rest = '_'.join(p[1:])
    who = 'def' if p[0].endswith('Def') or rest.endswith('DefWin') else 'off'
    if rest.endswith('_OffWin'): who = 'off'
    rest = re.sub(r'_(DefWin|OffWin)$', '', rest)
    return fam + '|' + rest, who
mk = collections.defaultdict(lambda: {'def': set(), 'off': set()})
for k, a in abilities.items():
    for e in a.get('effects', []):
        key, who = matchup_key(e); mk[key][who].add(k)
for a in abilities.values(): a['matchups'] = []
for key, s in mk.items():
    for d in s['def']:
        for o in s['off']:
            if d != o and abilities[d]['side'] != abilities[o]['side']:
                if o not in abilities[d]['matchups']: abilities[d]['matchups'].append(o)
                if d not in abilities[o]['matchups']: abilities[o]['matchups'].append(d)

out = {
    'sources': {'requirements': 'madden-school.com/abilities', 'mechanics': 'abilities.clutchtrait.com', 'captured': '2026-10-28'},
    'abilities': dict(sorted(abilities.items(), key=lambda kv: kv[1]['title'])),
}
json.dump(out, open(os.path.join(OUT, 'abilities-data.json'), 'w'), separators=(',', ':'))
arch = json.load(open(os.path.join(IN, 'archetypes.json')))
json.dump(arch, open(os.path.join(OUT, 'archetypes.json'), 'w'), separators=(',', ':'))
print(len(abilities), 'abilities;', sum(1 for a in abilities.values() if a['tiers']), 'with requirements;',
      sum(1 for a in abilities.values() if a.get('effects')), 'with mechanics;', 'problems:', problems[:5])

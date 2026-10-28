import json, harness
_alt=json.load(open('/home/claude/capfit/live_real.json'))
def base(r): return {int(k):v for k,v in _alt[harness.key(r)]['p'].items()}

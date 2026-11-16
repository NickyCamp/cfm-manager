"""Builds scripts/history/seed-ncl.json: NCL's transaction log from the old NCL site
(nickycamp/ncl-site index.html, its embedded DATA: txLog, tradeHistory, ratingHistory),
for CFM Manager's history log. The sync worker maps it onto EA roster ids the first
time it writes league-data/ncl/history.json.gz.

    python3 -I scripts/history/build-ncl-seed.py <ncl-site index.html> scripts/history/seed-ncl.json
"""
import json, re, sys

html = open(sys.argv[1], encoding="utf8").read()
D = json.loads(re.search(r'<script[^>]*id="ncl-data"[^>]*>(.*?)</script>', html, re.S).group(1))
abbr = {t["madden_team_id"]: t["abbr_name"].upper() for t in D["teams"]}
players = {p["roster_id"]: p for p in D["players"]}
DEV = {"N": 0, "S": 1, "SS": 2, "X": 3, "Normal": 0, "Star": 1, "Superstar": 2, "X-Factor": 3}

def who(rid, name):
    p = players.get(rid)
    born = f"{rid[:4]}-{rid[4:6]}-{rid[6:8]}" if rid and len(rid) >= 9 else None
    if p:
        return {"first": p["first_name"], "last": p["last_name"], "born": born}
    first, _, last = (name or "").partition(" ")
    return {"first": first, "last": last, "born": born}

def C(c):
    return None if not c or not c.get("len") else [c["len"], c["left"], c["total"] - c["bonus"], c["bonus"], c["cap"]]

def wk(w):
    title = re.sub(r"^\d{4}\s+", "", w["label"])
    return {"year": w["season"], "stage": w["stage"], "week": w["week"], "title": title}

KINDS = {"signed", "released", "extended", "restructured", "retired", "drafted", "expired"}
events = []

def tx(i, e, src):
    if e.get("type") not in KINDS:
        return
    rid = e.get("roster_id") or ""
    p = players.get(rid)
    w = wk(e["week"])
    before, after = C(e.get("before")), C(e.get("after"))
    # Every offseason entry came from the sync that rolled contracts over to 2028.
    caps = [2027, 2028] if w["stage"] == 2 else [2027, 2027]
    ev = {
        "id": f"ncl:{src}:{i}", "kind": e["type"], "at": e.get("detected_at"), "wk": w,
        "who": who(rid, e.get("name")), "name": e.get("name", ""), "pos": e.get("pos", ""), "age": e.get("age", 0), "ovr": e.get("ovr", 0),
        "dev": DEV.get(p["dev"], 0) if p else 0,
        "fromAbbr": abbr.get(e.get("from_team") or "", ""), "toAbbr": abbr.get(e.get("to_team") or "", ""),
    }
    if before: ev["before"] = before
    if after: ev["after"] = after
    if before or after: ev["caps"] = caps
    events.append(ev)

for i, e in enumerate(D["txLog"]["entries"]):
    tx(i, e, "log")
for i, t in enumerate(D["tradeHistory"]):
    if "received" in t:
        teams = [abbr.get(x, "") for x in t["teams"]]
        got = {abbr.get(k, ""): v for k, v in t["received"].items()}
        names = [x.get("name") or x.get("pick") for v in t["received"].values() for x in v]
        events.append({
            "id": f"ncl:trade:{i}", "kind": "trade", "at": t.get("detected_at"), "wk": wk(t["week"]),
            "name": ", ".join(n for n in names if n), "pos": "", "age": 0, "ovr": 0, "dev": 0,
            "deal": {"teams": teams, "got": got},
        })
    else:
        tx(i, t, "backfill")

# Overall and dev changes between the old site's weekly rating snapshots (2027 Week 8 on).
weeks = [w for w in D["ratingHistory"]["weeks"] if not w.startswith("2026")]
PO = {"Wildcard Playoff": 18, "Divisional Playoff": 19, "Conference Playoff": 20, "Super Bowl": 22}
def wk_of(label):
    y, rest = label.split(" ", 1)
    m = re.match(r"Week (\d+)$", rest)
    if m: return {"year": int(y), "stage": 1, "week": int(m.group(1)) - 1, "title": rest}
    if rest in PO: return {"year": int(y), "stage": 1, "week": PO[rest], "title": rest}
    return {"year": int(y), "stage": 2, "week": 1, "title": rest}
hist = D["ratingHistory"]["players"]
for a, b in zip(weeks, weeks[1:]):
    w = wk_of(b)
    for rid, h in hist.items():
        if a not in h or b not in h:
            continue
        (o0, d0), (o1, d1) = h[a], h[b]
        p = players.get(rid)
        base = {"at": None, "wk": w, "who": who(rid, f'{p["first_name"]} {p["last_name"]}' if p else ""),
                "name": f'{p["first_name"]} {p["last_name"]}' if p else "", "pos": p["pos"] if p else "", "age": p["age"] if p else 0,
                "ovr": o1, "dev": DEV.get(d1, 0), "toAbbr": abbr.get(p["madden_team_id"], "") if p else ""}
        if not base["name"]:
            continue
        if o0 != o1:
            events.append({"id": f"ncl:rating:{b}:{rid}", "kind": "rating", "change": [o0, o1], **base})
        if d0 != d1:
            events.append({"id": f"ncl:dev:{b}:{rid}", "kind": "dev", "change": [DEV[d0], DEV[d1]], **base})

json.dump({"trackedSince": D["txLog"]["trackedSince"], "events": events}, open(sys.argv[2], "w"), separators=(",", ":"))
from collections import Counter
print(len(events), Counter(e["kind"] for e in events))

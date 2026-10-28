"""Builds src/lib/league/real-contracts.json from OverTheCap contract data
published by nflverse (https://github.com/nflverse/nflverse-data, release "contracts").

    curl -L -o /tmp/hc.parquet https://github.com/nflverse/nflverse-data/releases/download/contracts/historical_contracts.parquet
    python3 scripts/real-contracts/build.py /tmp/hc.parquet

Madden 27 franchises start from real 2026 rosters and copy each player's real
contract in year by year, so while a player is still on that contract (or the
old years of an extension) his cap hits follow the real ones. The app only
uses an entry when it still lines up with EA's numbers (see realContracts.ts).

Each entry: [first, last, draftYear, startYear, caps[], value, pros[], proAfter]
  caps/pros: cap number and bonus proration ($10K) for startYear.. through the
  last year that pays cash (void years pay none); proAfter: proration left in
  void years after that; value: the current contract's total value ($10K).
"""
import sys, json, re, unicodedata
import pandas as pd

FIRST, LAST = 2024, 2036

def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", s)
    s = re.sub(r"[^a-z ]", " ", s)
    return " ".join(s.split())

df = pd.read_parquet(sys.argv[1])
df = df[df.is_active == True]
out = []
for _, r in df.iterrows():
    rows = {}
    for s in r.season_history if r.season_history is not None else []:
        try:
            y = int(s["year"])
        except (TypeError, ValueError):
            continue
        if FIRST <= y <= LAST:
            rows[y] = s
    paid = lambda y: y in rows and (rows[y].get("cash_paid") or 0) > 0 and (rows[y].get("cap_number") or 0) > 0.3
    # The run of paid seasons that includes 2026 (franchise start).
    if not paid(2026):
        continue
    start = 2026
    while paid(start - 1):
        start -= 1
    end = 2026
    while paid(end + 1):
        end += 1
    if end < 2027:
        continue
    caps = [round(rows[y]["cap_number"] * 100) for y in range(start, end + 1)]
    pros = [round((rows[y].get("prorated_bonus") or 0) * 100) for y in range(start, end + 1)]
    after = round(sum((s.get("prorated_bonus") or 0) * 100 for y, s in rows.items() if y > end))
    n = norm(r.player).split()
    if not n:
        continue
    dy = None if pd.isna(r.draft_year) else int(r.draft_year)
    out.append([n[0], n[-1], dy, start, caps, round((r.value or 0) * 100), pros, after])

out.sort(key=lambda x: (x[1], x[0]))
json.dump({
    "source": "OverTheCap via nflverse-data (contracts release)",
    "unit": 10000,
    "players": out,
}, open("src/lib/league/real-contracts.json", "w"), separators=(",", ":"))
print(len(out), "players")

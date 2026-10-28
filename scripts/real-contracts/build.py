"""Builds src/lib/league/real-contracts.json from OverTheCap contract data
published by nflverse (https://github.com/nflverse/nflverse-data, release "contracts").

    curl -L -o /tmp/hc.parquet https://github.com/nflverse/nflverse-data/releases/download/contracts/historical_contracts.parquet
    python3 scripts/real-contracts/build.py /tmp/hc.parquet

Madden 27 franchises start from real 2026 rosters and copy each player's real
contract in year by year, so while a player is still on that contract his
future cap hits follow the real ones. The app only uses an entry when it still
lines up with EA's numbers (see realContracts.ts).
"""
import sys, json, re, unicodedata
import pandas as pd

FIRST, LAST = 2026, 2035

def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", s)
    s = re.sub(r"[^a-z ]", " ", s)
    return " ".join(s.split())

df = pd.read_parquet(sys.argv[1])
df = df[df.is_active == True]
out = []
for _, r in df.iterrows():
    caps, pros = {}, {}
    for s in r.season_history if r.season_history is not None else []:
        try:
            y = int(s["year"])
        except (TypeError, ValueError):
            continue
        if FIRST <= y <= LAST:
            cap, base = s.get("cap_number") or 0, s.get("base_salary") or 0
            # Void / post-contract rows carry dead proration only; stop there.
            caps[y] = round(cap * 100) if cap > 0.5 and cap >= 0.9 * base else None
            pros[y] = round((s.get("prorated_bonus") or 0) * 100)
    years = []
    for y in range(FIRST, LAST + 1):
        v = caps.get(y)
        if v is None:
            break
        years.append(v)
    if len(years) < 2:
        continue
    n = norm(r.player).split()
    if not n:
        continue
    dy = None if pd.isna(r.draft_year) else int(r.draft_year)
    # Total value of the current real contract ($10K), to confirm Madden still carries this deal.
    # Bonus proration charged in each of those years, plus what's left after the
    # last one (void years), so an extension can tell old bonus from new.
    pro = [pros.get(FIRST + i, 0) for i in range(len(years))]
    after = sum(v for y, v in pros.items() if y >= FIRST + len(years))
    out.append([n[0], n[-1], dy, years, round((r.value or 0) * 100), pro, after])

out.sort(key=lambda x: (x[1], x[0]))
json.dump({
    "source": "OverTheCap via nflverse-data (contracts release)",
    "firstYear": FIRST,
    "unit": 10000,
    "players": out,
}, open("src/lib/league/real-contracts.json", "w"), separators=(",", ":"))
print(len(out), "players")

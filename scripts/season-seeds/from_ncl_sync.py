"""One-off (Nick, 2026-11-24): NCL's 2026 and 2027 seasons for CFM Manager's past-season stats.

CFM Manager only started keeping whole past seasons on 2026-11-24, after NCL had already rolled over
to 2028. The old NCL site's sync (NickyCamp/ncl-sync) kept every game, so this turns its saved
history into seed files the sync worker loads once (worker/sync-all.ts, seasonSeeds.ts):

  python3 scripts/season-seeds/from_ncl_sync.py <path to ncl-sync checkout> [ncl-site 2027 games.json]

  -> scripts/season-seeds/ncl-2026.json.gz, ncl-2027.json.gz

Players are keyed by their MyMadden id (birth date + presentation id); the worker matches them to
EA roster ids by birth date and name.
2026: every score (MyMadden's game list) but player stats only for preseason + Weeks 1-5 (+ part of 6),
from the one MyMadden export saved that season (site/old_data.json).
2027: every game, box score and player line (state/history/*.csv).
"""
import csv, gzip, json, os, sys

src = sys.argv[1]
H = os.path.join(src, "state", "history")
OUT = os.path.dirname(os.path.abspath(__file__))
YEAR_OF = {1: 2026, 2: 2027}  # MyMadden seasonIndex -> calendar year
PLAYOFF = {18: "Wild Card", 19: "Divisional", 20: "Conference Championship", 22: "Super Bowl"}


def num(x):
    try:
        f = float(x)
        return int(f) if f.is_integer() else f
    except (TypeError, ValueError):
        return 0


def rows(name):
    with open(os.path.join(H, name), newline="") as f:
        return list(csv.DictReader(f))


def week_title(stage, week):
    if stage == 0:
        return f"Preseason Week {week + 1}"
    return PLAYOFF.get(week, f"Week {week + 1}")


def split_name(full):
    parts = (full or "").strip().split(" ", 1)
    return (parts[0], parts[1]) if len(parts) == 2 else ("", parts[0] if parts else "")


meta = json.load(open(os.path.join(H, "game_meta.json")))

# EA renumbered every team id in NCL's 2027 offseason (claude/team-id-renumbering.md), and the saved files
# mix both numberings: map every team to its current id by nickname (MyMadden's newest game rows).
TEAM = {}
for r in sorted(rows("mymadden_games.csv"), key=lambda r: num(r["seasonIndex"])):
    TEAM[r["homeTeamName"]] = num(r["homeTeamId"])
    TEAM[r["awayTeamName"]] = num(r["awayTeamId"])
NAME_OF = {}
for r in rows("mymadden_games.csv"):
    NAME_OF[num(r["homeTeamId"])] = r["homeTeamName"]
    NAME_OF[num(r["awayTeamId"])] = r["awayTeamName"]
team = lambda tid, name=None: TEAM.get(name or NAME_OF.get(num(tid)), num(tid))
seasons = {y: {"games": {}, "lines": {}, "teamGames": {}, "people": {}} for y in YEAR_OF.values()}

# ---------- games (every season, both years) ----------
for r in rows("mymadden_games.csv"):
    si = num(r["seasonIndex"])
    if si not in YEAR_OF:
        continue
    y = YEAR_OF[si]
    gid = num(r["scheduleId"])
    status = num(r["status"])
    m = meta.get(f"{si}:{gid}") or {}
    tp = m.get("timesPlayed", r.get("timesPlayed"))
    simmed = None if tp in (None, "") else num(tp) == 0
    seasons[y]["games"][gid] = {
        "id": gid, "stage": num(r["stageIndex"]), "week": num(r["weekIndex"]),
        "home": team(r["homeTeamId"], r["homeTeamName"]) if num(r["homeTeamId"]) else 0,
        "away": team(r["awayTeamId"], r["awayTeamName"]) if num(r["awayTeamId"]) else 0,
        "hs": num(r["homeScore"]), "as": num(r["awayScore"]),
        "final": status >= 2, "simmed": simmed, "gotw": False,
    }


def person(y, mm, full, pos):
    if mm and mm not in seasons[y]["people"]:
        first, last = split_name(full)
        seasons[y]["people"][mm] = [first, last, pos]


def line(y, gid, mm, team):
    k = f"{gid}:{mm}"
    L = seasons[y]["lines"].get(k)
    if not L:
        L = {"g": gid, "p": mm, "t": team}
        seasons[y]["lines"][k] = L
    return L


def put(L, **kv):
    for k, v in kv.items():
        if v:
            L[k] = v


# ---------- 2027 stat lines (ncl-sync history) ----------
for r in rows("offensive.csv"):
    y = YEAR_OF.get(num(r["seasonIndex"]))
    if y != 2027:
        continue
    mm = r["rosterId"]
    person(y, mm, r.get("extendedName") or r["fullName"], r["pos"])
    L = line(y, num(r["gameId"]), mm, team(r["teamId"], r["teamName"]))
    put(L, pa=num(r["passAtt"]), pc=num(r["passComp"]), py=num(r["passYds"]), ptd=num(r["passTDs"]), pint=num(r["passInts"]),
        plng=num(r["passLongest"]), psk=num(r["passSacks"]),
        ra=num(r["rushAtt"]), ry=num(r["rushYds"]), rtd=num(r["rushTDs"]), rlng=num(r["rushLongest"]), rfum=num(r["rushFum"]),
        rbt=num(r["rushBrokenTackles"]),
        rc=num(r["recCatches"]), rcy=num(r["recYds"]), rctd=num(r["recTDs"]), rclng=num(r["recLongest"]), rcdrop=num(r["recDrops"]),
        rcyac=num(r["recYdsAfterCatch"]))
for r in rows("defensive.csv"):
    y = YEAR_OF.get(num(r["seasonIndex"]))
    if y != 2027:
        continue
    mm = r["rosterId"]
    person(y, mm, r.get("extendedName") or r["fullName"], r["pos"])
    L = line(y, num(r["gameId"] or r["scheduleId"]), mm, team(r["teamId"], r["teamName"]))
    put(L, tk=num(r["defTotalTackles"]), sk=num(r["defSacks"]), int=num(r["defInts"]), ff=num(r["defForcedFum"]), fr=num(r["defFumRec"]),
        dtd=num(r["defTDs"]), pd=num(r["defDeflections"]), sfty=num(r["defSafeties"]))
for r in rows("kicking.csv"):
    y = YEAR_OF.get(num(r["seasonIndex"]))
    if y != 2027:
        continue
    mm = r["rosterId"]
    person(y, mm, r.get("extendedName") or r["fullName"], r["pos"])
    L = line(y, num(r["gameId"] or r["scheduleId"]), mm, team(r["teamId"], r["teamName"]))
    put(L, fga=num(r["fGAtt"]), fgm=num(r["fGMade"]), fglng=num(r["fGLongest"]), xpa=num(r["xPAtt"]), xpm=num(r["xPMade"]))
for r in rows("punting.csv"):
    y = YEAR_OF.get(num(r["seasonIndex"]))
    if y != 2027:
        continue
    mm = r["rosterId"]
    person(y, mm, r.get("extendedName") or r["fullName"], r["pos"])
    L = line(y, num(r["gameId"] or r["scheduleId"]), mm, team(r["teamId"], r["teamName"]))
    put(L, pnt=num(r["puntAtt"]), pnty=num(r["puntYds"]), pntnet=num(r["puntNetYds"]), pnt20=num(r["puntsIn20"]), pntlng=num(r["puntLongest"]))
for r in rows("teamStats.csv"):
    y = YEAR_OF.get(num(r["seasonIndex"]))
    if y != 2027:
        continue
    gid, t = num(r["gameId"] or r["scheduleId"]), team(r["teamId"], r["teamName"])
    seasons[y]["teamGames"][f"{gid}:{t}"] = {
        "g": gid, "t": t, "yds": num(r["offTotalYds"]), "passYds": num(r["offPassYds"]), "rushYds": num(r["offRushYds"]),
        "firstDowns": num(r["off1stDowns"]), "third": [num(r["off3rdDownConv"]), num(r["off3rdDownAtt"])],
        "fourth": [num(r["off4thDownConv"]), num(r["off4thDownAtt"])], "redZone": [num(r["offRedZoneTDs"]), num(r["offRedZones"])],
        "turnovers": num(r.get("tOGiveaways") or r.get("tOGiveAways")), "takeaways": num(r["tOTakeaways"]),
        "sacks": num(r["defSacks"]), "penalties": num(r["penalties"]), "penaltyYds": num(r["penaltyYds"]),
    }

# ---------- 2026 stat lines (the Week 6 MyMadden export) ----------
old = json.load(open(os.path.join(src, "site", "old_data.json")))
# That export used its own team ids: map them to EA's by team name.
ea_team = TEAM
game_of = {str(g["madden_game_id"]): num(g["schedule_id"]) for g in old["games"]}
for r in old["offensiveStats"]:
    gid = game_of.get(str(r["game_id"]))
    t = ea_team.get(r["team_name"])
    if not gid or not t:
        continue
    mm = str(r["roster_id"])
    person(2026, mm, r["full_name"], r["pos"])
    L = line(2026, gid, mm, t)
    put(L, pa=num(r["pass_att"]), pc=num(r["pass_comp"]), py=num(r["pass_yds"]), ptd=num(r["pass_tds"]), pint=num(r["pass_ints"]),
        plng=num(r["pass_longest"]), psk=num(r["pass_sacks"]),
        ra=num(r["rush_att"]), ry=num(r["rush_yds"]), rtd=num(r["rush_tds"]), rlng=num(r["rush_longest"]), rfum=num(r["rush_fum"]),
        rbt=num(r["rush_broken_tackles"]),
        rc=num(r["rec_catches"]), rcy=num(r["rec_yds"]), rctd=num(r["rec_tds"]), rclng=num(r["rec_longest"]), rcdrop=num(r["rec_drops"]),
        rcyac=num(r["rec_yds_after_catch"]))
for r in old["defensiveStats"]:
    gid = game_of.get(str(r["game_id"]))
    t = ea_team.get(r["team_name"])
    if not gid or not t:
        continue
    mm = str(r["roster_id"])
    person(2026, mm, r["full_name"], r["pos"])
    L = line(2026, gid, mm, t)
    put(L, tk=num(r["def_tackles"]), sk=num(r["def_sacks"]), int=num(r["def_ints"]), ff=num(r["def_forced_fum"]), fr=num(r["def_fum_rec"]),
        dtd=num(r["def_tds"]), pd=num(r["def_deflections"]))
for r in old["teamGameStats"]:
    gid = game_of.get(str(r["game_id"]))
    t = ea_team.get(r["team_name"])
    if not gid or not t:
        continue
    seasons[2026]["teamGames"][f"{gid}:{t}"] = {
        "g": gid, "t": t, "yds": num(r["off_total_yds"]), "passYds": num(r["off_pass_yds"]), "rushYds": num(r["off_rush_yds"]),
        "firstDowns": num(r["off_1st_downs"]), "third": [num(r["off_3rd_down_conv"]), num(r["off_3rd_down_att"])],
        "fourth": [0, 0], "redZone": [0, 0], "turnovers": num(r["off_fum_lost"]) + num(r["off_ints_lost"]), "takeaways": 0,
        "sacks": num(r["def_sacks"]), "penalties": num(r["penalties"]), "penaltyYds": num(r["penalty_yds"]),
    }

# MyMadden's game list was last fetched before NCL's 2027 Conference Championship / Super Bowl were
# played, so they show 0-0 there. The old NCL site's last 2027 build (NickyCamp/ncl-site commit 2ff6fd3,
# 2026-11-18) has every final; its games were saved as JSON for this (third argument).
if len(sys.argv) > 2:
    for g in json.load(open(sys.argv[2])):
        y = YEAR_OF.get(num(g["season_index"]))
        mine = y and seasons[y]["games"].get(num(g["schedule_id"]))
        if not mine or num(g["status"]) < 2 or mine["final"]:
            continue
        mine.update(home=team(g["home_team_id"], g["home_team_name"]), away=team(g["away_team_id"], g["away_team_name"]),
                    hs=num(g["home_score"]), **{"as": num(g["away_score"])}, final=True)
        print(f"  {y} {mine['id']} week {mine['week']}: {g['away_team_name']} {g['away_score']} @ {g['home_team_name']} {g['home_score']}")

# A line's game must be in that season's schedule.
for y, s in seasons.items():
    games = s["games"]
    s["lines"] = {k: L for k, L in s["lines"].items() if L["g"] in games}
    s["teamGames"] = {k: t for k, t in s["teamGames"].items() if t["g"] in games}
    weeks = {}
    for g in games.values():
        w = weeks.setdefault((g["stage"], g["week"]), {"stage": g["stage"], "week": g["week"], "title": week_title(g["stage"], g["week"]), "games": 0, "played": 0})
        w["games"] += 1
        w["played"] += 1 if g["final"] else 0
    lined = {L["g"] for L in s["lines"].values()}
    out = {
        "year": y,
        "source": "ncl-sync (old NCL site)",
        "partialStats": y == 2026,
        "weeks": sorted(weeks.values(), key=lambda w: (w["stage"], w["week"])),
        "games": sorted(games.values(), key=lambda g: (g["stage"], g["week"], g["id"])),
        "lines": list(s["lines"].values()),
        "teamGames": list(s["teamGames"].values()),
        "people": s["people"],
    }
    path = os.path.join(OUT, f"ncl-{y}.json.gz")
    with gzip.open(path, "wt") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{y}: {len(out['games'])} games ({sum(g['final'] for g in out['games'])} final), {len(lined)} with player lines, "
          f"{len(out['lines'])} lines, {len(out['teamGames'])} team lines, {len(out['people'])} players -> {os.path.getsize(path)//1024} KB")

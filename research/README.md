# Research notebooks

Throwaway scripts behind the shipped logic, kept so the work can be rerun or
picked up later. Not part of the app build. Big inputs (league exports,
parquet/pickle files) are left out; rerun the sync to regenerate them.

## cap-formula/
Reverse-engineering how Madden projects cap hits for future years.
- `harness.py`: scores a model against observed cap hits (dollar-weighted miss).
- `r5.py`–`r9.py`, `fullmodel*.py`, `extmodel.py`: successive model attempts.
- `otc.py`, `otc_rules.py`: matching Madden deals to real NFL contracts (OverTheCap via nflverse).
- `*.json`: fitted parameters and snapshots used for comparison.
Result: the miss went from 15.0% to 6.7%. Shipped as `src/lib/league/cap.ts`,
`projection.ts`, `realContracts.ts` (+ `scripts/real-contracts/build.py`).

## abilities/
Archetype-rating formulas (EA doesn't export them) fit as non-negative weighted
sums of ratings on 5,476 players, plus eligibility checks.
- `fit.py`, `cfit.py`: fits; `label.py`: names the fitted archetypes; `check.py`, `test_elig.ts`: validation.
Shipped as `src/lib/league/abilities.ts`, `archetypes.json` (+ `scripts/abilities/build.py`; scraped inputs live in `scripts/abilities/input/`).

## Where everything else is written down
The Claude project "madden site" doc `claude/cfm-manager-platform.md` holds the
architecture, decisions and feature notes.

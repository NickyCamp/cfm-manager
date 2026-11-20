// Last-season summaries recovered for leagues that moved to a new year before the worker kept them
// (prevSeason.ts). Keyed "<slug>-<year>"; attached at load time when the data file has none.
import type { PrevSeason } from "../prevSeason";
import ncl2027 from "./ncl-2027.json";

export const PREV_SEEDS: Record<string, PrevSeason> = {
  "ncl-2027": ncl2027 as PrevSeason,
};

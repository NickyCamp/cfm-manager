// EA's own player portraits: transparent head-and-shoulders cut-outs on EA's ratings
// site, keyed by the export's portraitId. Real players are under madden-nfl-27.
// Generated draft-class players reuse a pool of generic faces that only exist under
// madden-nfl-26 (checked 2026-11-13 on NCL: all 148 generated faces load from -26,
// none from -27). The worker works out which folder has each id once and stores it
// on the player (portrait.game), so pages never guess.
// Like the NFL.com headshots, these are images we don't own: pages show them only to
// signed-in league members.
import type { LeagueData, Player } from "./types";

const HOST = "https://ratings-images-prod.pulse.ea.com/";
const GAMES = [27, 26];
const folder = (game: number) => `madden-nfl-${game}`;

/** The portrait as a card-sized cut-out (512 px square, transparent), or undefined. */
export function eaPortraitUrl(p: Player): string | undefined {
  const pt = p.portrait;
  if (!pt?.game) return undefined;
  return `${HOST}${folder(pt.game)}/portraits/${pt.id}.png?im=Resize=512`;
}

export const isEaPortraitUrl = (u: string | undefined) => Boolean(u?.startsWith(HOST));

async function exists(url: string) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) });
      if (r.ok) return true;
      if (r.status === 403 || r.status === 404) return false; // EA answers 403 for a missing file
    } catch { /* retry once */ }
  }
  return false;
}

/**
 * Fill in portrait.game for every player. Ids already resolved in the previous build are
 * reused; the rest are checked against EA (newest game first), 16 at a time.
 */
export async function resolvePortraits(prev: LeagueData | null, data: LeagueData, log: (s: string) => void) {
  const known = new Map<number, number>();
  for (const p of prev?.players ?? []) if (p.portrait?.game) known.set(p.portrait.id, p.portrait.game);
  const todo = [...new Set(data.players.filter((p) => p.portrait && !known.has(p.portrait.id)).map((p) => p.portrait!.id))];
  let next = 0, found = 0;
  const worker = async () => {
    while (next < todo.length) {
      const id = todo[next++];
      for (const g of GAMES) {
        if (await exists(`${HOST}${folder(g)}/portraits/${id}.png`)) { known.set(id, g); found++; break; }
      }
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  for (const p of data.players) if (p.portrait && known.has(p.portrait.id)) p.portrait.game = known.get(p.portrait.id);
  if (todo.length) log(`- EA portraits: checked ${todo.length} new ids, ${found} found.`);
}

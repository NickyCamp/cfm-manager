// The art for a player's card, as the site picks it: uploaded art (private
// bucket) → NFL.com headshot as a cut-out → EA portrait (cut-out) → none (jersey number card).
import { signedCardArt } from "@/lib/cardArtStore";
import { headshotUrl } from "@/lib/league/headshots";
import { eaPortraitUrl } from "@/lib/league/portraits";
import type { Player } from "@/lib/league/types";
import { imageDataUrl } from "./cardImage";

export async function cardArtFor(slug: string, p: Player): Promise<{ art?: string; cutout: boolean }> {
  const uploaded = await signedCardArt(slug, p.id, 300);
  const up = uploaded ? await imageDataUrl(uploaded) : null;
  if (up) return { art: up, cutout: false };
  const hs = headshotUrl(p);
  const cut = hs ? await imageDataUrl(hs.replace("f_auto", "f_png")) : null;
  if (cut) return { art: cut, cutout: true };
  const ea = eaPortraitUrl(p);
  const eaArt = ea ? await imageDataUrl(ea) : null;
  return eaArt ? { art: eaArt, cutout: true } : { cutout: false };
}

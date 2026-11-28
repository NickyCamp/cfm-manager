// Dev trait icons (Nick, 2026-11-28): Normal bronze, Star silver, Superstar gold, X-Factor red X.
// Same art the Discord bot uses as emojis (public/dev/*.png).
import { DEV_LABEL } from "@/lib/league/types";

const FILES = ["normal", "star", "superstar", "xfactor"] as const;

export function DevIcon({ dev, size = 16 }: { dev: number; size?: number }) {
  const k = Math.max(0, Math.min(3, dev || 0));
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/dev/${FILES[k]}.png`} alt={DEV_LABEL[k]} title={DEV_LABEL[k]} width={size} height={size} className="dev-ico" />;
}

/** Icon plus the trait's name ("[icon] Superstar"). */
export function DevName({ dev, size = 16 }: { dev: number; size?: number }) {
  return <span className="dev-name"><DevIcon dev={dev} size={size} />{DEV_LABEL[Math.max(0, Math.min(3, dev || 0))]}</span>;
}

export function money(n: number, opts: { sign?: boolean } = {}) {
  const sign = n < 0 ? "−" : opts.sign && n > 0 ? "+" : "";
  const a = Math.abs(n);
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`;
  return `${sign}$${a}`;
}

export const pct = (n: number, d: number, digits = 1) => (d ? ((n / d) * 100).toFixed(digits) : "0.0");
export const avg = (n: number, d: number, digits = 1) => (d ? (n / d).toFixed(digits) : "0.0");
export const heightText = (inches: number) => (inches ? `${Math.floor(inches / 12)}'${inches % 12}"` : "");

/** Readable text color on a team-color background. */
export function onColor(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#111" : "#fff";
}

/** A team's color that still shows on a white page (falls back to the secondary, then ink). */
export function teamInk(primary: string, secondary: string) {
  const lum = (hex: string) => {
    const n = parseInt(hex.replace("#", ""), 16);
    return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  };
  if (lum(primary) < 200) return primary;
  if (lum(secondary) < 200) return secondary;
  return "#12201a";
}

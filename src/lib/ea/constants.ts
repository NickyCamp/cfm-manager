// EA / Madden 27 Companion App constants.
//
// Adapted from snallabot (MIT License, Copyright (c) 2024 snallabot):
// https://github.com/snallabot/snallabot-service — src/dashboard/ea_constants.ts
//
// These change every Madden year. For Madden 28, take the new client id,
// secret and year values from snallabot's ea_constants.ts.
//
// The client secret is read from the EA_CLIENT_SECRET env var rather than kept
// in the repo.

export const AUTH_SOURCE = 317239;
export const REDIRECT_URL = "http://127.0.0.1/success";
export const CLIENT_ID = "MCA_27_COMP_APP";
export const MACHINE_KEY = "444d362e8e067fe2";
export const MADDEN_TWO = "27";
export const MADDEN_YEAR = "2027";
export const HIGH_LOAD = 1073807360;

export function clientSecret(): string {
  const s = process.env.EA_CLIENT_SECRET;
  if (!s) throw new Error("EA_CLIENT_SECRET is not set.");
  return s;
}

// Entitlement group -> Blaze console name and persona namespace.
export const CONSOLES: Record<string, { console: string; ns: string; label: string }> = {
  [`MADDEN_${MADDEN_TWO}XONE`]: { console: "xone", ns: "xbox", label: "Xbox One" },
  [`MADDEN_${MADDEN_TWO}PS4`]: { console: "ps4", ns: "ps3", label: "PS4" },
  [`MADDEN_${MADDEN_TWO}PC`]: { console: "pc", ns: "cem_ea_id", label: "PC" },
  [`MADDEN_${MADDEN_TWO}PS5`]: { console: "ps5", ns: "ps3", label: "PS5" },
  [`MADDEN_${MADDEN_TWO}XBSX`]: { console: "xbsx", ns: "xbox", label: "Xbox Series X|S" },
  [`MADDEN_${MADDEN_TWO}SDA`]: { console: "stadia", ns: "stadia", label: "Stadia" },
};

export const CONSOLE_LABEL: Record<string, string> = Object.fromEntries(
  Object.values(CONSOLES).map((c) => [c.console, c.label]),
);

export const BLAZE_SERVICE = (c: string) => `madden-${MADDEN_YEAR}-${c}`;
export const BLAZE_PRODUCT = (c: string) => `madden-${MADDEN_YEAR}-${c}-mca`;
export const WAL = "https://wal2.tools.gos.bio-iad.ea.com/wal";
export const UA = "Dalvik/2.1.0 (Linux; U; Android 13; sdk_gphone_x86_64 Build/TE1A.220922.031)";

/** The page a user opens to sign in to EA. After signing in, EA sends them to
 *  http://127.0.0.1/success?code=..., which won't load. They copy that address
 *  back into the app. */
export const EA_SIGN_IN_URL =
  `https://accounts.ea.com/connect/auth?hide_create=true&release_type=prod&response_type=code` +
  `&redirect_uri=${REDIRECT_URL}&client_id=${CLIENT_ID}&machineProfileKey=${MACHINE_KEY}` +
  `&authentication_source=${AUTH_SOURCE}`;

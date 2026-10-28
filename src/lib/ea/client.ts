// EA account sign-in and Madden (Blaze) game-server calls.
//
// Ported from ncl-sync/ea/sync.mjs, which has been pulling the NCL league
// successfully since 2026-10-25. The EA connection logic there was adapted
// from snallabot (MIT License, Copyright (c) 2024 snallabot):
// https://github.com/snallabot/snallabot-service
//
// Server-only: uses the EA client secret and Node's TLS options.

import { Agent } from "undici";
import { constants as cryptoConstants, createHash, randomBytes } from "node:crypto";
import {
  AUTH_SOURCE, BLAZE_PRODUCT, BLAZE_SERVICE, CLIENT_ID, CONSOLES, HIGH_LOAD,
  MACHINE_KEY, REDIRECT_URL, UA, WAL, clientSecret,
} from "./constants";

export type EaToken = {
  accessToken: string;
  refreshToken: string;
  expiry: number; // ms since epoch
  console: string;
};

export type EaPersona = { personaId: number; displayName: string; console: string };

export type EaLeague = {
  leagueId: number;
  leagueName: string;
  userTeamName?: string;
  raw: Record<string, unknown>;
};

export type BlazeSession = { sessionKey: string; blazeId: number; requestId: number };

// EA's game servers use legacy TLS renegotiation; Node rejects it by default.
const dispatcher = new Agent({
  connect: { rejectUnauthorized: false, secureOptions: cryptoConstants.SSL_OP_LEGACY_SERVER_CONNECT },
});

// undici's fetch accepts a dispatcher; the global fetch type doesn't list it.
type FetchInit = RequestInit & { dispatcher?: Agent };
const blazeFetch = (url: string, init: FetchInit) => fetch(url, init as RequestInit);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function eaForm(body: string) {
  const res = await fetch("https://accounts.ea.com/connect/token", {
    method: "POST",
    headers: {
      "Accept-Charset": "UTF-8",
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body,
  });
  const text = await res.text();
  let json: { access_token?: string; refresh_token?: string; expires_in?: number } | null;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok || !json?.access_token) {
    throw new EaError(`EA sign-in didn't work (HTTP ${res.status}). The code may have expired or already been used.`, text.slice(0, 300));
  }
  return json as { access_token: string; refresh_token: string; expires_in: number };
}

export class EaError extends Error {
  detail?: string;
  constructor(message: string, detail?: string) { super(message); this.detail = detail; }
}

/** Pulls the code out of whatever the user pasted: the full
 *  http://127.0.0.1/success?code=... address, or just the code. */
export function extractCode(pasted: string): string {
  const t = pasted.trim();
  const m = t.match(/[?&]code=([^&\s]+)/);
  return m ? m[1] : t;
}

/**
 * Exchanges the one-time code for EA sessions — one per Madden persona on the
 * account (a user who plays on PS5 and Xbox gets two). The code is single-use,
 * so everything that needs it happens in this one call.
 */
export async function signInWithCode(pasted: string): Promise<{ persona: EaPersona; token: EaToken }[]> {
  const code = extractCode(pasted);
  const secret = clientSecret();
  const first = await eaForm(
    `authentication_source=${AUTH_SOURCE}&client_secret=${secret}&grant_type=authorization_code&code=${code}` +
    `&redirect_uri=${REDIRECT_URL}&release_type=prod&client_id=${CLIENT_ID}`,
  );
  const at = first.access_token;

  const info = await (await fetch(`https://accounts.ea.com/connect/tokeninfo?access_token=${at}`, {
    headers: { "User-Agent": UA, "X-Include-Deviceid": "true" },
  })).json();
  const ents = await (await fetch(`https://gateway.ea.com/proxy/identity/pids/${info.pid_id}/entitlements/?status=ACTIVE`, {
    headers: { "User-Agent": UA, "X-Expand-Results": "true", Authorization: `Bearer ${at}` },
  })).json();
  type Ent = { entitlementTag: string; groupName: string; pidUri: string };
  const valid: Ent[] = (ents?.entitlements?.entitlement || []).filter(
    (e: Ent) => (e.entitlementTag === "ONLINE_ACCESS" || e.entitlementTag === "TRIAL_ONLINE_ACCESS") && CONSOLES[e.groupName],
  );
  if (!valid.length) {
    throw new EaError("This EA account doesn't own Madden 27 with online access. Make sure you signed in with the EA account linked to your console.");
  }

  type Persona = { personaId: number; displayName: string; namespaceName: string; ent: string };
  const personas: Persona[] = [];
  for (const e of valid) {
    const r = await (await fetch(
      `https://gateway.ea.com/proxy/identity${e.pidUri}/personas?status=ACTIVE&access_token=${at}`,
      { headers: { "User-Agent": UA, "X-Expand-Results": "true" } },
    )).json();
    for (const p of r?.personas?.persona || []) {
      if (p.namespaceName === CONSOLES[e.groupName].ns) personas.push({ ...p, ent: e.groupName });
    }
  }
  if (!personas.length) throw new EaError("No Madden 27 profile was found on this EA account.");

  const out: { persona: EaPersona; token: EaToken }[] = [];
  for (const p of personas) {
    const consoleName = CONSOLES[p.ent].console;
    const loc = await fetch(
      `https://accounts.ea.com/connect/auth?hide_create=true&release_type=prod&response_type=code&redirect_uri=${REDIRECT_URL}` +
      `&client_id=${CLIENT_ID}&machineProfileKey=${MACHINE_KEY}&authentication_source=${AUTH_SOURCE}&access_token=${at}` +
      `&persona_id=${p.personaId}&persona_namespace=${p.namespaceName}`,
      {
        redirect: "manual",
        headers: {
          "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0 Mobile Safari/537.36",
          "X-Requested-With": "com.ea.gp.madden19companionapp",
        },
      },
    );
    const location = loc.headers.get("location") || "";
    const code2 = new URLSearchParams(location.replace(REDIRECT_URL, "")).get("code");
    if (!code2) continue; // this persona couldn't be authorized; try the others
    const tok = await eaForm(
      `authentication_source=${AUTH_SOURCE}&code=${code2}&grant_type=authorization_code&token_format=JWS&release_type=prod` +
      `&client_secret=${secret}&redirect_uri=${REDIRECT_URL}&client_id=${CLIENT_ID}`,
    );
    out.push({
      persona: { personaId: p.personaId, displayName: p.displayName, console: consoleName },
      token: { accessToken: tok.access_token, refreshToken: tok.refresh_token, expiry: Date.now() + tok.expires_in * 1000, console: consoleName },
    });
  }
  if (!out.length) throw new EaError("EA wouldn't authorize any Madden profile on this account. Try signing in again.");
  return out;
}

/** Returns a token that's good for at least another minute. */
export async function refreshToken(t: EaToken): Promise<EaToken> {
  if (Date.now() < t.expiry - 60_000) return t;
  const tok = await eaForm(
    `grant_type=refresh_token&client_id=${CLIENT_ID}&client_secret=${clientSecret()}&release_type=prod` +
    `&refresh_token=${t.refreshToken}&authentication_source=${AUTH_SOURCE}&token_format=JWS`,
  );
  return { ...t, accessToken: tok.access_token, refreshToken: tok.refresh_token || t.refreshToken, expiry: Date.now() + tok.expires_in * 1000 };
}

// ---------------- Blaze (Madden game servers) ----------------

const blazeHeaders = (t: EaToken) => ({
  "Accept-Charset": "UTF-8",
  Accept: "application/json",
  "X-BLAZE-ID": BLAZE_SERVICE(t.console),
  "X-BLAZE-VOID-RESP": "XML",
  "X-Application-Key": "MADDEN-MCA",
  "Content-Type": "application/json",
  "User-Agent": UA,
});

export async function blazeLogin(t: EaToken): Promise<BlazeSession> {
  const res = await blazeFetch(`${WAL}/authentication/login`, {
    dispatcher, method: "POST", headers: blazeHeaders(t),
    body: JSON.stringify({ accessToken: t.accessToken, productName: BLAZE_PRODUCT(t.console) }),
  });
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    return { sessionKey: j.userLoginInfo.sessionKey, blazeId: j.userLoginInfo.personaDetails.personaId, requestId: 1 };
  } catch {
    throw new EaError("Couldn't log in to the Madden servers. EA may be down; try again in a few minutes.", text.slice(0, 300));
  }
}

function messageAuth(blazeId: number, requestId: number) {
  const rand = randomBytes(4);
  const data = JSON.stringify({ staticData: "05e6a7ead5584ab4", requestId, blazeId });
  const xor = createHash("md5").update(rand).update(Buffer.from("634203362017bf72f70ba900c0aa4e6b", "hex")).digest();
  const scrambled = Buffer.from(data, "utf-8").map((b, i) => b ^ xor[i % 16]);
  const authBytes = Buffer.concat([rand, scrambled]);
  const authCode = createHash("md5").update(Buffer.from("3a53413521464c3b6531326530705b70203a2900", "hex")).update(authBytes).digest("base64");
  return { authData: authBytes.toString("base64"), authCode, authType: 17039361 };
}

type BlazeRequest = {
  commandName: string; componentId: number; commandId: number; componentName: string;
  requestPayload: Record<string, unknown>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function blaze(t: EaToken, s: BlazeSession, req: BlazeRequest): Promise<any> {
  const { requestPayload, ...rest } = req;
  const body = {
    apiVersion: 2,
    clientDevice: 3,
    requestInfo: JSON.stringify({
      ...rest,
      messageAuthData: messageAuth(s.blazeId, s.requestId++),
      messageExpirationTime: Math.floor(Date.now() / 1000),
      deviceId: MACHINE_KEY,
      ipAddress: "127.0.0.1",
      requestPayload: JSON.stringify(requestPayload),
    }),
  };
  const res = await blazeFetch(`${WAL}/mca/Process/${s.sessionKey}`, {
    dispatcher, method: "POST", headers: blazeHeaders(t), body: JSON.stringify(body),
  });
  const j = JSON.parse(await res.text());
  if (j.error) throw new EaError("The Madden servers returned an error.", JSON.stringify(j.error).slice(0, 300));
  return j.responseInfo.value;
}

/** Export calls, with patient retries on EA's "high load" and timeout errors. */
export async function exportCall(
  t: EaToken, s: BlazeSession, type: string, body: Record<string, unknown>, tries = 6,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ ok: true; data: any; attempts: number } | { ok: false; error: string; attempts: number }> {
  let last = "";
  for (let i = 0; i < tries; i++) {
    const res = await blazeFetch(`${WAL}/mca/${type}/${s.sessionKey}`, {
      dispatcher, method: "POST", headers: blazeHeaders(t), body: JSON.stringify(body),
    });
    const text = (await res.text()).replaceAll(/[\u0000-\u001F\u007F-\u009F]/g, "");
    let j;
    try { j = JSON.parse(text); } catch { last = `unreadable response (HTTP ${res.status})`; await sleep(2000 * 2 ** i); continue; }
    if (j?.error) {
      last = j.error.errorcode === HIGH_LOAD ? "EA high-load error (1073807360)" : `${j.error.errorname || "error"} ${j.error.errorcode || ""}`.trim();
      if (j.error.errorcode === HIGH_LOAD || j.error.errorname === "ERR_TIMEOUT") { await sleep(2000 * 2 ** i); continue; }
      return { ok: false, error: last, attempts: i + 1 };
    }
    return { ok: true, data: j, attempts: i + 1 };
  }
  return { ok: false, error: last, attempts: tries };
}

/** The Connected Franchise leagues this persona belongs to. */
export async function listLeagues(t: EaToken): Promise<EaLeague[]> {
  const s = await blazeLogin(t);
  const r = await blaze(t, s, {
    commandName: "Mobile_GetMyLeagues", componentId: 2060, commandId: 801, requestPayload: {}, componentName: "franchisemode",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (r?.leagues || []).map((l: any) => ({
    leagueId: Number(l.leagueId),
    leagueName: String(l.leagueName || `League ${l.leagueId}`),
    userTeamName: typeof l.userTeamName === "string" ? l.userTeamName : undefined,
    raw: l,
  }));
}

export async function leagueHub(t: EaToken, s: BlazeSession, leagueId: number) {
  return blaze(t, s, {
    commandName: "Mobile_Career_GetLeagueHub", componentId: 2060, commandId: 811, requestPayload: { leagueId }, componentName: "franchisemode",
  });
}

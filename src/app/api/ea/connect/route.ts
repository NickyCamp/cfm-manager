// POST /api/ea/connect  { code }
// Takes the http://127.0.0.1/success?code=... address the user pasted, signs in
// to EA once per Madden profile on that account, saves the sessions (encrypted)
// and returns every franchise league those profiles belong to.

import { NextResponse } from "next/server";
import { EaError, listLeagues, signInWithCode } from "@/lib/ea/client";
import { CONSOLE_LABEL } from "@/lib/ea/constants";
import { encryptJson } from "@/lib/crypto";
import { currentUser, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export type ConnectResult = {
  leagues: {
    connectionId: string;
    eaLeagueId: number;
    leagueName: string;
    console: string;
    consoleLabel: string;
    personaName: string;
    userTeamName?: string;
    existingSlug?: string; // already on CFM Manager
  }[];
  warnings: string[];
};

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  if (!code || code.trim().length < 6) {
    return NextResponse.json({ error: "Paste the full address EA sent you to (it starts with http://127.0.0.1/success)." }, { status: 400 });
  }

  try {
    const sessions = await signInWithCode(code);
    const admin = supabaseAdmin();
    const result: ConnectResult = { leagues: [], warnings: [] };

    for (const { persona, token } of sessions) {
      const { data: conn, error } = await admin
        .from("ea_connections")
        .upsert(
          {
            user_id: user.id,
            persona_id: persona.personaId,
            persona_name: persona.displayName,
            console: persona.console,
            token_ciphertext: encryptJson(token),
            status: "ok",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,persona_id,console" },
        )
        .select("id")
        .single();
      if (error || !conn) throw new Error(`Couldn't save the EA connection: ${error?.message}`);

      let leagues;
      try {
        leagues = await listLeagues(token);
      } catch (e) {
        result.warnings.push(`Couldn't load leagues for ${persona.displayName} (${CONSOLE_LABEL[persona.console] || persona.console}): ${(e as Error).message}`);
        continue;
      }
      if (!leagues.length) continue;

      const { data: existing } = await admin
        .from("leagues")
        .select("slug, ea_league_id")
        .eq("console", persona.console)
        .in("ea_league_id", leagues.map((l) => l.leagueId));
      const slugById = new Map((existing || []).map((l) => [Number(l.ea_league_id), l.slug as string]));

      for (const l of leagues) {
        result.leagues.push({
          connectionId: conn.id,
          eaLeagueId: l.leagueId,
          leagueName: l.leagueName,
          console: persona.console,
          consoleLabel: CONSOLE_LABEL[persona.console] || persona.console,
          personaName: persona.displayName,
          userTeamName: l.userTeamName,
          existingSlug: slugById.get(l.leagueId),
        });
      }
    }
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof EaError ? e.message : "Something went wrong talking to EA. Try again in a minute.";
    console.error("ea/connect failed", e instanceof EaError ? e.detail : e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

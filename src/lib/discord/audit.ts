// /audit abilities | games | players [team] [public] (Nick, 2026-11-18): checks the league's rules,
// which a commissioner edits on the site (Admin → Rule audits). The checks are in league/audit.ts.
import type { LeagueData } from "../league/types";
import type { LeagueHistory } from "../league/history";
import { auditAbilities, auditGames, auditPlayers, auditRulesOf, type AuditResult } from "../league/audit";
import type { Embed, Message } from "./api";

export const AUDIT_KINDS = {
  abilities: "Abilities: banned abilities and limited-ability duplicates",
  games: "Games: catch shares and the passing/rushing TD split (user games)",
  players: "Players: position changes (allowed moves, timing, SS/XF once a season)",
} as const;
export type AuditKind = keyof typeof AUDIT_KINDS;

const TITLE: Record<AuditKind, string> = { abilities: "🎖️ Ability audit", games: "🏈 Game audit", players: "🔀 Player audit" };
const MAX_DESC = 3900;

export function runAudit(kind: AuditKind, d: LeagueData, h: LeagueHistory | null, settings: Record<string, unknown> | null | undefined, teamId?: number): AuditResult {
  const rules = auditRulesOf(settings);
  return kind === "abilities" ? auditAbilities(d, rules, teamId) : kind === "games" ? auditGames(d, rules, teamId) : auditPlayers(d, h, rules, teamId);
}

export function auditMessage(kind: AuditKind, r: AuditResult, d: LeagueData, o: { url: (p?: string) => string; footer: { text: string }; team?: string }): Message {
  const teams = new Map(d.teams.map((t) => [t.id, t]));
  const byTeam = new Map<number, typeof r.findings>();
  for (const f of r.findings) (byTeam.get(f.team) || byTeam.set(f.team, []).get(f.team)!).push(f);
  const order = [...byTeam.entries()].sort(([a, x], [b, y]) =>
    y.filter((f) => f.severity === "violation").length - x.filter((f) => f.severity === "violation").length
    || (teams.get(a)?.abbr || "").localeCompare(teams.get(b)?.abbr || ""));
  const violations = r.findings.filter((f) => f.severity === "violation").length;
  const watch = r.findings.length - violations;

  const head = r.findings.length
    ? `**${violations} violation${violations === 1 ? "" : "s"}**${watch ? ` · ${watch} to watch` : ""} on ${byTeam.size} team${byTeam.size === 1 ? "" : "s"}`
    : "✅ **No rule breaks found.**";
  const parts: string[] = [head];
  let shown = 0;
  const footNotes = r.notes.map((n) => `_${n}_`).join("\n");
  const budget = MAX_DESC - footNotes.length - 120;
  let used = head.length;
  outer: for (const [tid, list] of order) {
    const t = teams.get(tid);
    const block = [`\n**${t ? `${t.abbr} ${t.name}` : "Unknown team"}**${t?.user ? ` · ${t.user}` : ""}`];
    for (const f of list.sort((a, b) => Number(a.severity === "watch") - Number(b.severity === "watch"))) {
      block.push(`${f.severity === "violation" ? "🚫" : "⚠️"} ${f.rule}: ${f.text}`);
    }
    for (let i = 0; i < block.length; i++) {
      if (used + block[i].length + 1 > budget) break outer;
      parts.push(block[i]); used += block[i].length + 1;
      if (i) shown++;
    }
  }
  if (shown < r.findings.length) parts.push(`\n…and ${r.findings.length - shown} more. Narrow it with the team option, or see them all on the site.`);
  if (footNotes) parts.push(`\n${footNotes}`);
  const embed: Embed = {
    title: `${TITLE[kind]}${o.team ? ` · ${o.team}` : ""}`,
    url: o.url(`/admin/audit?k=${kind}`),
    description: parts.join("\n"),
    color: violations ? 0xd64545 : watch ? 0xf2c200 : 0x2e9e5b,
    footer: { text: `${o.footer.text} · rules: Admin → Rule audits` },
  };
  return { embeds: [embed], allowed_mentions: { parse: [] } };
}

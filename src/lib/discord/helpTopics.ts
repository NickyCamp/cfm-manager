// /help's walkthrough topics (Nick, 2026-11-18). Kept apart from help.ts, which reads COMMANDS:
// commands.ts needs this list for /help's choices, so importing help.ts from there would be a loop.
export const HELP_TOPICS: [string, string][] = [
  ["start", "Getting started"],
  ["setup", "Setting up a server (admins)"],
  ["lookups", "Looking up players, teams and games"],
  ["markets", "Markets and betting"],
  ["trades", "Trades and the trade block"],
  ["audits", "Rule audits"],
  ["packs", "Card packs"],
  ["trouble", "Something isn't working"],
];

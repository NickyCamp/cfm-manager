"use client";
// Live tab: shared pieces for the stream players (see MultiView.tsx). Twitch's player needs the site's own
// domain as `parent`, so embeds are built in the browser once that's known.
import type { Platform } from "@/lib/streams";

export type LiveItem = {
  teamId: number; abbr: string; team: string; primary: string; user: string;
  platform: Platform; channel: string; url: string; videoId?: string;
  title?: string; viewers?: number; startedAt?: string;
  game?: { id: number; label: string; final: boolean };
};

export const NAME: Record<Platform, string> = { twitch: "Twitch", kick: "Kick", youtube: "YouTube" };

export function embedSrc(i: Pick<LiveItem, "platform" | "channel" | "videoId">, host: string, muted = true) {
  if (i.platform === "twitch") return `https://player.twitch.tv/?channel=${encodeURIComponent(i.channel)}&parent=${encodeURIComponent(host)}&muted=${muted}&autoplay=true`;
  if (i.platform === "kick") return `https://player.kick.com/${encodeURIComponent(i.channel)}?muted=${muted}&autoplay=true`;
  return i.videoId ? `https://www.youtube.com/embed/${i.videoId}?autoplay=1&mute=${muted ? 1 : 0}` : "";
}

export function since(iso?: string) {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

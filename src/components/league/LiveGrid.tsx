"use client";
// Live tab: the embedded players for everyone streaming right now. Twitch's player needs the site's own
// domain as `parent`, so the embeds are built in the browser once that's known.
import { useEffect, useState } from "react";
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

export function LiveGrid({ items }: { items: LiveItem[] }) {
  const [host, setHost] = useState("");
  useEffect(() => setHost(window.location.hostname), []);
  return (
    <div className={`live-grid${items.length === 1 ? " one" : ""}`}>
      {items.map((i) => {
        const src = host ? embedSrc(i, host) : "";
        return (
          <article key={`${i.teamId}:${i.platform}:${i.channel}:${i.videoId ?? ""}`} className="live-card" style={{ borderTopColor: i.primary }}>
            <div className="live-frame">
              {src ? <iframe src={src} title={`${i.team} live on ${NAME[i.platform]}`} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen loading="lazy" />
                : <div className="live-frame-empty muted">Loading player…</div>}
            </div>
            <div className="live-meta">
              <div className="live-head">
                <span className="live-pill">● Live</span>
                <strong>{i.abbr}</strong>
                {i.game && <span className="muted">{i.game.label}{i.game.final ? " (final)" : ""}</span>}
                <span className="muted live-right">{i.viewers != null ? `${i.viewers.toLocaleString()} watching` : ""}{i.startedAt ? ` · ${since(i.startedAt)}` : ""}</span>
              </div>
              {i.title && <div className="live-title">{i.title}</div>}
              <div className="small muted">{i.user} · <a href={i.url} target="_blank" rel="noopener noreferrer">Open on {NAME[i.platform]} ↗</a></div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

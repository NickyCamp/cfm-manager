import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fonts and X-Factor ruby badges read at runtime by the Discord card image route (next/og).
  outputFileTracingIncludes: {
    "/api/discord/card": ["./assets/fonts/**", "./public/abilities/xf/**"],
    "/api/discord/pack": ["./assets/fonts/**", "./public/abilities/xf/**"],
  },
};

export default nextConfig;

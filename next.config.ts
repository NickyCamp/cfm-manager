import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fonts, ability badge art and card frames read at runtime by the Discord card image route (next/og).
  outputFileTracingIncludes: {
    "/api/discord/card": ["./assets/fonts/**", "./public/abilities/**", "./public/frames/**", "./public/ovr/**"],
    "/api/discord/pack": ["./assets/fonts/**", "./public/abilities/**", "./public/frames/**", "./public/ovr/**"],
  },
};

export default nextConfig;

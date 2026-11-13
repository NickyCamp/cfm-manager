import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fonts read at runtime by the Discord card image route (next/og).
  outputFileTracingIncludes: { "/api/discord/card": ["./assets/fonts/**"], "/api/discord/pack": ["./assets/fonts/**"] },
};

export default nextConfig;

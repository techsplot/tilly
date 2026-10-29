import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev badge sits on top of the message bar on phones.
  devIndicators: false,
  // Emits .next/standalone with only the files the server needs, so the
  // Docker image does not ship node_modules or the source.
  output: "standalone",
};

export default nextConfig;

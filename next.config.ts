import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev badge sits on top of the message bar on phones.
  devIndicators: false,
  // Emits .next/standalone with only the files the server needs, so the
  // Docker image does not ship node_modules or the source.
  output: "standalone",
  // Browsers must always fetch the latest service worker after a deploy.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

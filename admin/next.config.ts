import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    externalDir: true,
  },
  // @lib/* path alias is resolved via tsconfig.json paths — no webpack/turbopack alias needed
  turbopack: {},
  async headers() {
    return [
      {
        // Allow cross-origin requests from Bandtracker (GitHub Pages) and the glasses app
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        ],
      },
    ];
  },
};

export default nextConfig;

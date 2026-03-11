import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  experimental: {
    externalDir: true,
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      // Resolves the @lib/* path alias used in API routes (e.g. @lib/staff-extraction)
      '@lib': path.resolve(__dirname, '../lib'),
    };
    return config;
  },
};

export default nextConfig;

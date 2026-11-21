import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: repoRoot,
  // Keep preview builds separate from the running dashboard's production files.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;

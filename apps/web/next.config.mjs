import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

// One .env at the repo root serves both the API and the web app.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// forceReload: Next has already run loadEnvConfig for apps/web and caches it, which would skip the root .env.
nextEnv.loadEnvConfig(repoRoot, process.env.NODE_ENV !== "production", undefined, true);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Every seat shares one URL now; old seat-prefixed links still land in the right place.
  async redirects() {
    const seat = ":role(business|product|engineering|developer)";
    return [
      { source: `/app/${seat}`, destination: "/app", permanent: false },
      { source: `/app/${seat}/:path*`, destination: "/app/:path*", permanent: false },
    ];
  },
  // The browser talks to the API through this app (same origin, no CORS); NOX_API_URL says where it runs.
  async rewrites() {
    const api = (process.env.NOX_API_URL || "http://localhost:8000").replace(/\/$/, "");
    return [
      { source: "/api/v1/:path*", destination: `${api}/api/v1/:path*` },
      { source: "/healthz", destination: `${api}/healthz` },
    ];
  },
};

export default nextConfig;

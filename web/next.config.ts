import type { NextConfig } from "next";

/**
 * The evidence workspace UI talks to the NeuroLens FastAPI backend.
 *
 * The browser must never address the backend directly: in the preview
 * environment the page origin is a proxied host, not localhost. Every call is a
 * relative `/api/...` path that Next.js rewrites to the backend, so the same
 * bundle works locally, in the preview, and in production behind a reverse
 * proxy.
 */
const BACKEND = process.env.NEUROLENS_API ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${BACKEND}/api/:path*` },
      { source: "/static/:path*", destination: `${BACKEND}/static/:path*` },
    ];
  },
  // The sandbox preview serves this app from a proxied host; without this the
  // dev server rejects cross-origin HMR requests from it.
  allowedDevOrigins: ["*.e2b.app", "*.e2b.dev"],
};

export default nextConfig;

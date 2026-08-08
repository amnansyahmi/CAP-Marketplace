import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Both drivers must stay outside the bundler: pg resolves optional native
  // dependencies at runtime, and PGlite ships a WASM binary the bundler would
  // otherwise try to inline.
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite 는 WASM 을 들고 다니므로 번들링하지 않고 Node 런타임에서 그대로 require 한다.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;

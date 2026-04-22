import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    typedRoutes: true,
  },
  serverExternalPackages: ["@gxl/epub-parser"],
};

export default config;

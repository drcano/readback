import type { NextConfig } from "next";

const config: NextConfig = {
  // readback-core ships TypeScript source; Next compiles it like app code.
  transpilePackages: ["@readbackhq/core", "@readbackhq/verify", "@readback/evals"],
};

export default config;

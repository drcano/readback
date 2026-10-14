import type { NextConfig } from "next";

const config: NextConfig = {
  // readback-core ships TypeScript source; Next compiles it like app code.
  transpilePackages: ["@readback/core", "@readback/verify", "@readback/evals"],
};

export default config;

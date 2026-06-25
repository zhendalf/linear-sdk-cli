import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Live integration tests mutate a shared workspace; never run them in parallel.
    fileParallelism: !process.env.LINEAR_CLI_LIVE,
    testTimeout: process.env.LINEAR_CLI_LIVE ? 30_000 : 5_000,
  },
});

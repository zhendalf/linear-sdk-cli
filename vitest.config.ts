import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Live integration tests mutate a shared workspace; never run them in parallel.
    fileParallelism: !process.env.LINEAR_CLI_LIVE,
    // Live tests spawn the built CLI per assertion (process start + network);
    // a generous timeout absorbs API latency without being flaky.
    testTimeout: process.env.LINEAR_CLI_LIVE ? 60_000 : 5_000,
    hookTimeout: process.env.LINEAR_CLI_LIVE ? 60_000 : 10_000,
  },
});

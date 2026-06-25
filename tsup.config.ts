import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin/linear.ts", "src/index.ts"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  outDir: "dist",
  clean: true,
  dts: { entry: "src/index.ts" },
  sourcemap: true,
  splitting: false,
  // Keep the bundle lean; ship deps as runtime requires.
  external: ["@linear/sdk", "commander", "picocolors", "smol-toml", "@inquirer/prompts"],
  // The shebang lives in src/bin/linear.ts; esbuild preserves it for that entry.
});

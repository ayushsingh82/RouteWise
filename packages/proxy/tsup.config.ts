import { defineConfig } from "tsup";

// Zero runtime dependencies: the shared engine in ../../src/lib is bundled in.
export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  dts: { entry: ["src/index.ts"] },
  clean: true,
});

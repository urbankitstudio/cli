import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

// Paths resolve from this file, so the build gives the same output from any working directory.
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  entry: { uks: here("./src/uks.ts") },
  format: ["esm"],
  dts: false,
  sourcemap: false,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "node22",
  platform: "node",
  outDir: here("./dist"),
  // Explicit, because tsup reads both from the package.json in the working directory.
  outExtension: () => ({ js: ".js" }),
  // @urbankitstudio/atlas stays external (it is the one dependency) so `uks --version`
  // reports the atlas data actually installed beside the CLI.
  external: ["@urbankitstudio/atlas"],
  banner: { js: "#!/usr/bin/env node" },
});

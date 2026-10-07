import { defineConfig } from "vitest/config";

export default defineConfig({
  // Don't inherit the parent app's postcss/tailwind config — this package is
  // standalone and ships no CSS. Empty inline postcss config short-circuits
  // Vite's upward search.
  css: {
    postcss: { plugins: [] },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});

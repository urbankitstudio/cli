import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { atlasIndex } from "@urbankitstudio/atlas";

function readVersion(path: string | URL): string | null {
  try {
    const v = (JSON.parse(readFileSync(path, "utf8")) as { version?: unknown }).version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

// src/version.ts and the bundled dist/uks.js both sit one level below package.json.
export const CLI_VERSION = readVersion(new URL("../package.json", import.meta.url)) ?? "0.0.0-unknown";

/** The installed @urbankitstudio/atlas version. Its package.json is not exported, so find it beside the resolved entry. */
export function atlasPackageVersion(): string | null {
  try {
    const entry = createRequire(import.meta.url).resolve("@urbankitstudio/atlas");
    return readVersion(join(dirname(entry), "..", "package.json"));
  } catch {
    return null;
  }
}

export function versionInfo() {
  return {
    cli: CLI_VERSION,
    atlas_package: atlasPackageVersion(),
    atlas_data: {
      schema_version: atlasIndex.version,
      last_updated: atlasIndex.lastUpdated,
      totals: atlasIndex.totals,
    },
    node: process.version,
  };
}

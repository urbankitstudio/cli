#!/usr/bin/env node
/**
 * Is the published @urbankitstudio/cli current? Asked every day by
 * .github/workflows/package-currency.yml.
 *
 * WHY. On 2026-09-26 Leo made the surfaces AI agents install the FIRST surface
 * of every UrbanKit Studio change: a new tool or fix reaches npm before the
 * paid tiers are touched and before the site. That order is real only if a lag
 * gets noticed, and the fact that shows a lag lives OUTSIDE this repo: the
 * version npm serves. No hermetic test can see it. Modelled on the atlas
 * repo's check of the same name.
 *
 * ONE CHECK. The atlas check also compares its data with the live site and
 * looks for data changed without a bump; a CLI carries no data, so only the
 * link between this repo and `npm install` is asked:
 *
 *   PUBLISH LAG    package.json here against npm's `latest`.
 *                  Repo ahead: the publish did not happen.
 *                  npm ahead: this mirror lags the release.
 *                  npm has no such package: it was never published (or was
 *                  unpublished), which is the repo ahead by every version.
 *
 * "Could not ask" is not "current": a registry that does not answer is red
 * with its own message.
 *
 * Usage:  node scripts/check-package-currency.mjs [repoDir]
 *   repoDir defaults to this script's repository. CLI_CURRENCY_REGISTRY_URL
 *   replaces the registry URL when set; that is how
 *   scripts/package-currency.test.mjs runs the whole script against a local
 *   server. The workflow never sets it, and that test asserts it.
 * Exit 0 = no red. Exit 1 = red.
 */
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REGISTRY_LATEST_URL = "https://registry.npmjs.org/@urbankitstudio%2Fcli/latest";

/** The monorepo's convention for scripts that call out: browser-like, and
 *  named, so a server log can tell what asked. */
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) cli-package-currency/1.0";
const TIMEOUT_MS = 20_000;

export const REMEDY =
  "read this repo's publish.yml run for the push that set the version; a first publish is a manual step (see publish.yml's header)";

// ------------------------------------------------------------------ semver --
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Throws on anything that is not a plain semver string. An unparseable
 *  version must never compare as "equal": that is how a lax compare turns a
 *  broken input into a green check. */
export function parseSemver(version) {
  const m = typeof version === "string" ? SEMVER.exec(version) : null;
  if (!m) throw new Error(`${JSON.stringify(version)} is not a semver version`);
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] };
}

/** Semver precedence as -1, 0 or 1. Numeric, never lexical: as strings
 *  "0.10.0" sorts before "0.9.0", which would name the wrong direction on
 *  exactly the bump where it matters. Build metadata is ignored. */
export function compareSemver(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  for (let i = 0; i < 3; i += 1) {
    if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1;
  }
  if (x.pre.length === 0 && y.pre.length === 0) return 0;
  if (x.pre.length === 0) return 1; // a release outranks its prereleases
  if (y.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1; // the shorter set of identifiers sorts first
    if (q === undefined) return 1;
    const pNum = /^\d+$/.test(p);
    const qNum = /^\d+$/.test(q);
    if (pNum && qNum) {
      if (Number(p) !== Number(q)) return Number(p) < Number(q) ? -1 : 1;
    } else if (pNum !== qNum) {
      return pNum ? -1 : 1; // numeric identifiers sort before alphanumeric ones
    } else if (p !== q) {
      return p < q ? -1 : 1;
    }
  }
  return 0;
}

// ---------------------------------------------------------------- verdicts --
const ok = (check, message) => ({ check, status: "ok", message });
const red = (check, message) => ({ check, status: "red", message });

const explain = (err) => {
  const cause = err?.cause?.code ?? err?.cause?.message;
  return `${err?.message ?? String(err)}${cause ? ` (${cause})` : ""}`;
};

/** The one message for a source that did not answer, kept distinct so a red
 *  that means "unknown" is never read as a red that means "late". */
export function couldNotAsk(check, source, err) {
  return red(
    check,
    `could not ask ${source}: ${explain(err)}. This is NOT a verdict that the package is current; the check did not run.`,
  );
}

export function publishLagVerdict(repoVersion, npmVersion) {
  const CHECK = "PUBLISH LAG";
  let order;
  try {
    order = compareSemver(repoVersion, npmVersion);
  } catch (err) {
    return red(
      CHECK,
      `cannot compare this checkout's ${JSON.stringify(repoVersion)} with npm's ${JSON.stringify(npmVersion)}: ${err.message}`,
    );
  }
  if (order === 0) return ok(CHECK, `package.json ${repoVersion} = npm latest ${npmVersion}`);
  if (order > 0) {
    return red(
      CHECK,
      `this checkout is ${repoVersion} but npm latest is ${npmVersion}: the repo is AHEAD of npm, so the publish did not happen. ` +
        `Read the publish.yml run for the push that moved the version. npm's latest can trail a finished publish by a minute or two, so re-run once before acting.`,
    );
  }
  return red(
    CHECK,
    `npm latest is ${npmVersion} but this checkout is ${repoVersion}: npm is AHEAD of the repo, so this mirror lags the release. ` +
      `This repo moves only when the monorepo's cli-sync-push.yml pushes; read its runs.`,
  );
}

export function neverPublishedVerdict(repoVersion) {
  return red(
    "PUBLISH LAG",
    `npm has no @urbankitstudio/cli at all, but this checkout is ${repoVersion ?? "unreadable"}: the package was never published, or was unpublished. Remedy: ${REMEDY}.`,
  );
}

// -------------------------------------------------------------------- run --
/** Resolves to the parsed body, or throws. A 404 throws an error carrying
 *  `status: 404`, because for the registry that answer has a meaning of its
 *  own (no such package) and must not be read as "the registry is down". */
export async function fetchJson(url, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} ${res.statusText}`.trim());
      err.status = res.status;
      throw err;
    }
    // Inside the try, so the timeout covers a body that stalls as well.
    return await res.json();
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`no answer within ${timeoutMs / 1000}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Runs the check and returns its verdicts; prints nothing. */
export async function run({ root, registryUrl, getJson = fetchJson }) {
  let repoVersion = null;
  let manifestError = null;
  try {
    const v = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
    if (typeof v === "string") repoVersion = v;
  } catch (err) {
    manifestError = err;
  }

  try {
    let body;
    try {
      body = await getJson(registryUrl);
    } catch (err) {
      if (err?.status === 404) return [neverPublishedVerdict(repoVersion)];
      return [couldNotAsk("PUBLISH LAG", `the npm registry (${registryUrl})`, err)];
    }
    if (typeof body?.version !== "string") {
      return [couldNotAsk("PUBLISH LAG", `the npm registry (${registryUrl})`, new Error("it answered without a version field"))];
    }
    if (repoVersion === null) {
      return [
        red(
          "PUBLISH LAG",
          `could not read this checkout's package.json version: ${manifestError ? explain(manifestError) : "no version string"}`,
        ),
      ];
    }
    return [publishLagVerdict(repoVersion, body.version)];
  } catch (err) {
    return [red("PUBLISH LAG", `the check itself failed: ${explain(err)}`)];
  }
}

/** GitHub reads `::error::` lines as annotations, and decodes `%` sequences in
 *  their text, so `%`, CR and LF are escaped. */
const escapeData = (text) => text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

export function render(verdicts) {
  return verdicts.map((v) =>
    v.status === "ok" ? `ok    ${v.check}: ${v.message}` : `::error::${escapeData(`${v.check}: ${v.message}`)}`,
  );
}

export const exitCodeFor = (verdicts) => (verdicts.some((v) => v.status === "red") ? 1 : 0);

// ------------------------------------------------------------------- main --
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** True only when node was pointed at this file. Imported by the tests, it
 *  must stay silent; executed by the workflow, it must run. The second half is
 *  the one that fails quietly (exit 0, nothing checked), so the tests execute
 *  the file directly and read what it prints. */
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    const self = realpathSync(fileURLToPath(import.meta.url));
    const entry = realpathSync(resolve(process.argv[1]));
    return process.platform === "win32" ? self.toLowerCase() === entry.toLowerCase() : self === entry;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const root = resolve(process.argv[2] ?? REPO_ROOT);
  const registryUrl = process.env.CLI_CURRENCY_REGISTRY_URL || REGISTRY_LATEST_URL;
  console.log(`@urbankitstudio/cli currency for ${root}`);
  console.log(`asking ${registryUrl}`);
  console.log("");
  const verdicts = await run({ root, registryUrl });
  for (const line of render(verdicts)) console.log(line);
  console.log("");
  console.log(exitCodeFor(verdicts) ? "red: npm does not serve this checkout's version" : "green: npm serves this checkout's version");
  process.exitCode = exitCodeFor(verdicts);
}

#!/usr/bin/env node
/**
 * Verify a packed @urbankitstudio/cli before it can reach the registry.
 *
 * ONE implementation, called by BOTH ci.yml and publish.yml, and that is the
 * point rather than tidiness. The sibling atlas repo learned it from an
 * adversarial review: its two workflows had drifted, and since they trigger
 * independently on a push to main, with no `needs:` between them, ci.yml going
 * red has no power to stop publish.yml. The weaker gate was the only one that
 * could actually block a release. Two copies of a check are two checks, and the
 * one that matters is always the weaker.
 *
 * Everything is asserted in JS, not shell, because the atlas shell version
 * failed OPEN: `[ "undefined" -lt 100 ]` errors with "integer expected", and
 * inside an `if A || B` that error is simply treated as a false clause.
 *
 * WHAT A CLI PACKAGE MUST BE, checked here:
 *   - exactly five files: CHANGELOG.md LICENSE README.md dist/uks.js package.json
 *     (anything more is a leak -- src/, test/, a stray .env -- and anything
 *     less is a broken install)
 *   - `bin` maps `uks` to dist/uks.js and nothing else
 *   - dist/uks.js starts with `#!/usr/bin/env node`, or `uks` fails on every
 *     POSIX install with an error that names no file
 *   - the packed bin RUNS, and `uks --version` reports the packed package.json
 *     version. The CLI reads its version from `../package.json` at run time, so
 *     this proves the manifest shipped beside the bundle, not just the bundle.
 *   - lifecycle scripts are on an allow-list (see below)
 *
 * Usage:  node scripts/verify-package.mjs <dir> [repoRoot]
 * `<dir>` is the EXTRACTED TARBALL's package directory, never the working tree:
 * `files` and .npmignore decide what ships, and the working tree does not.
 * `[repoRoot]` is where `npm ci` installed the runtime dependency
 * (@urbankitstudio/atlas, kept external in the bundle). Node resolves an ESM
 * import by walking up from the importing FILE, never from the cwd and never
 * through NODE_PATH, so the extracted bundle cannot see the repo's
 * node_modules on its own. The script links `<dir>/node_modules` to it for the
 * run and removes the link afterwards, so the listing above is taken before
 * the link exists and nothing is left behind.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, posix, relative, resolve, sep } from "node:path";

const ROOT = resolve(process.argv[2] ?? ".");
const REPO = process.argv[3] ? resolve(process.argv[3]) : null;

const NAME = "@urbankitstudio/cli";
const BIN_NAME = "uks";
const BIN_PATH = "dist/uks.js";
const SHEBANG = "#!/usr/bin/env node";

/** The whole tarball, by design. A change here is a decision, made in the
 *  monorepo's packages/cli `files` field AND here, in the same change. */
const EXPECTED_FILES = ["CHANGELOG.md", "LICENSE", "README.md", BIN_PATH, "package.json"];

/** Lifecycle scripts that may run during a publish. Anything outside this list
 *  is refused rather than trusted.
 *
 *  The mitigation for a gap this script does NOT otherwise close: `npm pack`
 *  and `npm publish` produce SEPARATE archives, and `prepublishOnly` runs only
 *  on publish. So the bytes verified here are not literally the bytes that
 *  ship, and a lifecycle script that rewrote files would slip past every check.
 *  Publishing the packed tarball would close it properly, but npm's docs do not
 *  state whether provenance survives a pre-packed tarball publish, and
 *  provenance is the reason this package publishes from a public repo. So the
 *  scripts are pinned instead. */
const ALLOWED_LIFECYCLE = new Map([
  ["prepublishOnly", "npm run typecheck && npm run test && npm run build"],
]);
const LIFECYCLE_KEYS = ["prepublishOnly", "prepack", "postpack", "prepare", "publish", "postpublish"];

const problems = [];
const notes = [];
const fail = (msg) => problems.push(msg);
const ok = (msg) => notes.push(msg);

// ---------------------------------------------------------------- manifest --
let pkg;
try {
  pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
} catch (err) {
  console.error(`FATAL: cannot read package.json in ${ROOT} -- ${err.message}`);
  process.exit(1);
}

if (pkg.name !== NAME) fail(`package.json name is ${JSON.stringify(pkg.name)}, not ${NAME}`);
else ok(`name is ${NAME}`);

// --------------------------------------------------------------- the files --
// Taken BEFORE the node_modules link below exists, so the link can never be
// mistaken for package content.
function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(relative(ROOT, full).split(sep).join("/"));
  }
  return out;
}
const packed = listFiles(ROOT).sort();
const extra = packed.filter((f) => !EXPECTED_FILES.includes(f));
const missing = EXPECTED_FILES.filter((f) => !packed.includes(f));
if (extra.length) fail(`the tarball carries files outside the expected five: ${extra.join(", ")}`);
if (missing.length) fail(`the tarball is missing: ${missing.join(", ")}`);
if (!extra.length && !missing.length) ok(`tarball holds exactly ${EXPECTED_FILES.join(" ")}`);

for (const doc of ["README.md", "LICENSE", "CHANGELOG.md"]) {
  const p = join(ROOT, doc);
  if (existsSync(p) && statSync(p).size === 0) fail(`${doc} is empty`);
}
// The missing-file case is already reported above; this judges only a file that shipped.
if (existsSync(join(ROOT, "CHANGELOG.md"))) {
  const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
  if (typeof pkg.version !== "string" || !changelog.includes(pkg.version)) {
    fail(`CHANGELOG.md does not mention ${pkg.version}; the release rule is a version bump AND a CHANGELOG entry`);
  } else {
    ok(`CHANGELOG.md mentions ${pkg.version}`);
  }
}

// --------------------------------------------------------------------- bin --
// npm may rewrite "./dist/uks.js" to "dist/uks.js" when it packs, so compare
// normalised paths rather than strings.
const bin = pkg.bin;
const binKeys = bin && typeof bin === "object" ? Object.keys(bin) : [];
if (binKeys.length !== 1 || binKeys[0] !== BIN_NAME) {
  fail(`package.json bin must map exactly one name, "${BIN_NAME}"; found ${JSON.stringify(bin)}`);
} else if (posix.normalize(String(bin[BIN_NAME])) !== BIN_PATH) {
  fail(`package.json bin.${BIN_NAME} is ${JSON.stringify(bin[BIN_NAME])}, not ${BIN_PATH}`);
} else {
  ok(`bin ${BIN_NAME} -> ${BIN_PATH}`);
}

const binFile = join(ROOT, BIN_PATH);
if (existsSync(binFile)) {
  const firstLine = readFileSync(binFile, "utf8").split("\n", 1)[0];
  if (firstLine !== SHEBANG) {
    fail(`${BIN_PATH} starts with ${JSON.stringify(firstLine.slice(0, 60))}, not ${JSON.stringify(SHEBANG)}`);
  } else {
    ok(`${BIN_PATH} starts with ${SHEBANG}`);
  }
}

// --------------------------------------------------------- lifecycle hooks --
for (const key of LIFECYCLE_KEYS) {
  const script = pkg.scripts?.[key];
  if (script === undefined) continue;
  const allowed = ALLOWED_LIFECYCLE.get(key);
  if (allowed === undefined) {
    fail(`package.json defines a ${key} script, which is not on the allow-list: ${script}`);
  } else if (script !== allowed) {
    fail(`package.json ${key} is not the expected script.\n      expected: ${allowed}\n      found:    ${script}`);
  } else {
    ok(`${key} is the expected script`);
  }
}

// -------------------------------------------------------- the bin runs -----
const link = join(ROOT, "node_modules");
let linked = false;
function runBin(args) {
  return spawnSync(process.execPath, [binFile, ...args], { encoding: "utf8", timeout: 30_000 });
}
if (existsSync(binFile)) {
  try {
    if (!existsSync(link)) {
      if (!REPO) {
        fail(`no node_modules beside ${ROOT} and no repoRoot argument, so ${BIN_PATH} cannot resolve its dependency`);
      } else if (!existsSync(join(REPO, "node_modules"))) {
        fail(`${join(REPO, "node_modules")} does not exist; run npm ci first`);
      } else {
        // "junction" is honoured on Windows (no admin needed) and ignored elsewhere.
        symlinkSync(join(REPO, "node_modules"), link, "junction");
        linked = true;
      }
    }
    if (existsSync(link)) {
      const plain = runBin(["--version"]);
      const expectPrefix = `uks ${pkg.version} `;
      if (plain.status !== 0) {
        fail(`\`uks --version\` exited ${plain.status}${plain.error ? ` (${plain.error.message})` : ""}: ${(plain.stderr || "").trim().slice(0, 400)}`);
      } else if (!plain.stdout.startsWith(expectPrefix)) {
        fail(`\`uks --version\` printed ${JSON.stringify(plain.stdout.trim().slice(0, 200))}, which does not start with ${JSON.stringify(expectPrefix)}`);
      } else {
        ok(`uks --version -> ${plain.stdout.trim()}`);
      }

      // The agent-facing form. An agent reads `cli` from this, so it is held to
      // the same version, parsed rather than pattern-matched.
      const json = runBin(["--version", "--json"]);
      let parsed = null;
      try {
        parsed = JSON.parse(json.stdout);
      } catch {
        // reported below
      }
      if (json.status !== 0 || parsed === null) {
        fail(`\`uks --version --json\` exited ${json.status} and printed ${JSON.stringify((json.stdout || "").slice(0, 200))}`);
      } else if (parsed.cli !== pkg.version) {
        fail(`\`uks --version --json\` reports cli ${JSON.stringify(parsed.cli)}, but package.json is ${pkg.version}`);
      } else {
        ok(`uks --version --json reports cli ${parsed.cli}`);
      }
    }
  } finally {
    if (linked && lstatSync(link, { throwIfNoEntry: false })) unlinkSync(link);
  }
}

// ------------------------------------------------------------------ report --
console.log(`verifying ${ROOT}`);
console.log(`  ${pkg.name}@${pkg.version} | ${packed.length} files`);
for (const note of notes) console.log(`  ok    ${note}`);
if (problems.length) {
  console.log("");
  for (const problem of problems) console.error(`::error::${problem}`);
  console.error(`\n${problems.length} problem(s); this package must not be published`);
  process.exit(1);
}
console.log(`\nall ${notes.length} checks passed`);

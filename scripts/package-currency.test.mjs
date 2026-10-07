/**
 * Tests for scripts/check-package-currency.mjs. package-currency.yml runs this
 * file before the check itself, so a check that has stopped checking goes red
 * before it gets the chance to pass.
 *
 * node:test, not vitest, and in scripts/, not test/, on purpose. test/ and
 * vitest.config.ts arrive from the monorepo by the mirror sync (rsync
 * --delete), which would overwrite or delete anything this repo put there;
 * .github/ and scripts/ are the paths the sync leaves alone. vitest collects
 * only the *.test.ts files under test/, so `npm test` never runs this file,
 * and tsconfig.json does not include scripts/.
 *
 * No network. The script runs end to end against a local server.
 *
 * Run: node --test scripts/package-currency.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { REMEDY, compareSemver, neverPublishedVerdict, publishLagVerdict } from "./check-package-currency.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const SCRIPT = join(HERE, "check-package-currency.mjs");
const WORKFLOW = join(REPO, ".github", "workflows", "package-currency.yml");
const TEST_CMD = "node --test scripts/package-currency.test.mjs";
const CHECK_CMD = "node scripts/check-package-currency.mjs";

// ------------------------------------------------------------------ semver --
test("compareSemver orders numerically, not lexically", () => {
  assert.equal(compareSemver("0.1.0", "0.1.0"), 0);
  assert.equal(compareSemver("0.10.0", "0.9.0"), 1);
  assert.equal(compareSemver("0.9.0", "0.10.0"), -1);
  assert.equal(compareSemver("1.0.0", "0.99.99"), 1);
  assert.equal(compareSemver("0.1.10", "0.1.9"), 1);
});

test("compareSemver ranks prereleases the way semver does", () => {
  assert.equal(compareSemver("1.0.0-rc.1", "1.0.0"), -1);
  assert.equal(compareSemver("1.0.0", "1.0.0-rc.1"), 1);
  assert.equal(compareSemver("1.0.0-alpha", "1.0.0-alpha.1"), -1);
  assert.equal(compareSemver("1.0.0-alpha.2", "1.0.0-alpha.10"), -1);
  assert.equal(compareSemver("1.0.0-1", "1.0.0-alpha"), -1);
  assert.equal(compareSemver("1.0.0-beta", "1.0.0-alpha"), 1);
  assert.equal(compareSemver("1.0.0+build.5", "1.0.0"), 0);
});

test("compareSemver refuses what it cannot parse instead of calling it equal", () => {
  for (const bad of ["0.1", "v0.1.0", "", undefined, null, "0.1.0\nrelease=true"]) {
    assert.throws(() => compareSemver(bad, "0.1.0"), /not a semver version/, `accepted ${JSON.stringify(bad)}`);
    assert.throws(() => compareSemver("0.1.0", bad), /not a semver version/, `accepted ${JSON.stringify(bad)}`);
  }
});

// ------------------------------------------------------------- PUBLISH LAG --
test("PUBLISH LAG: the same version on both sides is green", () => {
  const v = publishLagVerdict("0.1.0", "0.1.0");
  assert.equal(v.status, "ok", v.message);
  assert.equal(v.check, "PUBLISH LAG");
});

test("PUBLISH LAG: the repo ahead of npm means the publish did not happen", () => {
  const v = publishLagVerdict("0.1.1", "0.1.0");
  assert.equal(v.status, "red");
  assert.match(v.message, /the repo is AHEAD of npm, so the publish did not happen/);
});

test("PUBLISH LAG: npm ahead of the repo means the mirror lags, even where the strings sort the other way", () => {
  // As strings "0.9.0" > "0.10.0"; a lexical compare would blame the publish.
  const v = publishLagVerdict("0.9.0", "0.10.0");
  assert.equal(v.status, "red");
  assert.match(v.message, /npm is AHEAD of the repo, so this mirror lags the release/);
  assert.match(v.message, /cli-sync-push\.yml/);
});

test("PUBLISH LAG: a version that cannot be parsed is red, never equal", () => {
  const v = publishLagVerdict("0.1.0", "latest");
  assert.equal(v.status, "red");
  assert.match(v.message, /cannot compare/);
});

test("PUBLISH LAG: a package npm does not have is red and names the remedy", () => {
  const v = neverPublishedVerdict("0.1.0");
  assert.equal(v.status, "red");
  assert.match(v.message, /never published/);
  assert.ok(v.message.includes(REMEDY), v.message);
});

// ------------------------------------------------------------ end to end --
/** Serves the registry answer the script asks for; `answer` changes per case. */
async function localRegistry() {
  const state = { answer: { status: 200, body: {} } };
  const server = createServer((req, res) => {
    const answer = req.url === "/registry" ? state.answer : { status: 500, body: "wrong route" };
    const isText = typeof answer.body === "string";
    res.writeHead(answer.status, { "content-type": isText ? "text/html" : "application/json" });
    res.end(isText ? answer.body : JSON.stringify(answer.body));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  return {
    state,
    registryUrl: `http://127.0.0.1:${port}/registry`,
    close: () => new Promise((done) => server.close(done)),
  };
}

/** Executes the script the way the workflow does. Asynchronously, never with
 *  execFileSync: a blocked event loop could not answer the child's requests. */
function runScript(repoDir, registryUrl) {
  return new Promise((done) => {
    execFile(
      process.execPath,
      [SCRIPT, repoDir],
      { encoding: "utf8", timeout: 60_000, env: { ...process.env, CLI_CURRENCY_REGISTRY_URL: registryUrl } },
      (err, stdout, stderr) => {
        done({ code: err ? (typeof err.code === "number" ? err.code : -1) : 0, stdout, stderr });
      },
    );
  });
}

test("executed directly, the script asks the registry and exits by its verdict", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-currency-"));
  const registry = await localRegistry();
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "0.2.0" }));
    const show = (r) => `exit ${r.code}\n${r.stdout}${r.stderr}`;

    registry.state.answer = { status: 200, body: { name: "fixture", version: "0.2.0" } };
    let r = await runScript(dir, registry.registryUrl);
    assert.equal(r.code, 0, show(r));
    assert.match(r.stdout, /^ok    PUBLISH LAG: /m, show(r));

    registry.state.answer = { status: 200, body: { name: "fixture", version: "0.1.0" } };
    r = await runScript(dir, registry.registryUrl);
    assert.equal(r.code, 1, show(r));
    assert.match(r.stdout, /^::error::PUBLISH LAG: this checkout is 0\.2\.0 but npm latest is 0\.1\.0/m, show(r));

    // The registry's answer for a package it does not have.
    registry.state.answer = { status: 404, body: { error: "Not found" } };
    r = await runScript(dir, registry.registryUrl);
    assert.equal(r.code, 1, show(r));
    assert.match(r.stdout, /^::error::PUBLISH LAG: npm has no @urbankitstudio\/cli at all/m, show(r));

    // A registry that is down is "could not ask", never "never published".
    registry.state.answer = { status: 503, body: { error: "unavailable" } };
    r = await runScript(dir, registry.registryUrl);
    assert.equal(r.code, 1, show(r));
    assert.match(r.stdout, /^::error::PUBLISH LAG: could not ask the npm registry/m, show(r));

    // A 200 that is not the answer asked for.
    registry.state.answer = { status: 200, body: "<html>a challenge page, not JSON</html>" };
    r = await runScript(dir, registry.registryUrl);
    assert.equal(r.code, 1, show(r));
    assert.match(r.stdout, /^::error::PUBLISH LAG: could not ask the npm registry/m, show(r));
  } finally {
    await registry.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

// ---------------------------------------------------------- the workflow --
/** The workflow's code with comments removed: a check that matched the file's
 *  own prose would pass while the steps did nothing. */
function workflowCode() {
  return readFileSync(WORKFLOW, "utf8")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)#.*$/, "").trimEnd())
    .filter((line) => line.trim() !== "");
}

test("package-currency.yml runs this file, then the script, by these paths, and never on push", () => {
  assert.ok(existsSync(WORKFLOW), ".github/workflows/package-currency.yml is missing");
  const code = workflowCode();

  const onAt = code.findIndex((line) => /^on:\s*$/.test(line));
  assert.notEqual(onAt, -1, "no top-level `on:` block");
  const triggers = [];
  for (const line of code.slice(onAt + 1)) {
    if (/^\S/.test(line)) break;
    const m = /^ {2}([A-Za-z_]+):/.exec(line);
    if (m) triggers.push(m[1]);
  }
  assert.deepEqual(
    triggers.sort(),
    ["schedule", "workflow_dispatch"],
    "a check that needs the network must never run on push or pull_request",
  );

  const runs = code.map((line) => /^\s*(?:-\s+)?run:\s*(.+)$/.exec(line)?.[1].trim()).filter(Boolean);
  assert.ok(runs.includes(TEST_CMD), `no step runs \`${TEST_CMD}\`; steps run: ${JSON.stringify(runs)}`);
  assert.ok(runs.includes(CHECK_CMD), `no step runs \`${CHECK_CMD}\`; steps run: ${JSON.stringify(runs)}`);
  assert.ok(runs.indexOf(TEST_CMD) < runs.indexOf(CHECK_CMD), "the tests must run before the check");
  for (const cmd of [TEST_CMD, CHECK_CMD]) {
    const rel = cmd.split(" ").at(-1);
    assert.ok(existsSync(join(REPO, rel)), `the workflow runs ${rel}, which does not exist`);
  }
  assert.ok(
    !runs.some((cmd) => /\bnpm\s+(ci|install|i)\b/.test(cmd)),
    "no dependency install: the check uses node builtins only",
  );
  assert.ok(
    !code.some((line) => line.includes("CLI_CURRENCY_")),
    "the workflow must ask the real registry, never the test seam",
  );
});

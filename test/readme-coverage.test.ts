import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mainHelp } from "../src/cli.js";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const commands = [...mainHelp().matchAll(/^ {2}([a-z][a-z-]+) {2,}/gm)].map((m) => m[1]!);

/** The text between a heading and the next heading of any level. */
function section(heading: string): string {
  const start = readme.indexOf(`\n${heading}\n`);
  if (start < 0) throw new Error(`README has no '${heading}' section`);
  const rest = readme.slice(start + heading.length + 2);
  const end = rest.search(/^#{1,6} /m);
  return end < 0 ? rest : rest.slice(0, end);
}

/** Commands named by the "| `uks <cmd> ..." rows of the Commands table. */
const tableCommands = [...section("## Commands").matchAll(/^\| `uks ([a-z][a-z-]+)[^|]*` \|/gm)].map((m) => m[1]!);

/** Commands run by the lines of the Examples code block (`uks --version` is not a command). */
const exampleBlock = /```sh\n([\s\S]*?)```/.exec(section("### Examples"))?.[1] ?? "";
const exampleCommands = [...new Set([...exampleBlock.matchAll(/^uks ([a-z][a-z-]+)/gm)].map((m) => m[1]!))];

describe("README covers the CLI", () => {
  it("the help lists the commands", () => {
    expect(commands).toEqual(["plans", "whoami", "usage", "states", "find", "county", "lookup", "request-county", "login", "logout"]);
  });

  it("the Commands table has one row per command, in help order", () => {
    expect(tableCommands).toEqual(commands);
  });

  it("the Examples block runs every command, in help order", () => {
    expect(exampleCommands).toEqual(commands);
  });

  it.each(["UKS_API_KEY", "UKS_API_BASE", "--json", "--quiet", "--api-base", "## For agents"])("mentions %s", (s) => {
    expect(readme).toContain(s);
  });

  it("the exit-code table rows, by full text", () => {
    const rows = section("## Exit codes")
      .split("\n")
      .filter((l) => /^\| \d \|/.test(l));
    expect(rows).toEqual([
      '| 0 | Success, including "no match" and "not in the atlas" answers |',
      "| 1 | Refused: no key where one is needed, a key the server rejects (401/402/403), or a plan without the feature |",
      "| 2 | Could not run: bad arguments, a network failure, a request the server rejects (other 4xx), a server error (5xx), an unreadable response |",
      "| 3 | Rate limit, quota or county-request budget exhausted (429) |",
    ]);
  });

  it("names the three 429 error strings", () => {
    for (const code of ["`rate-limited`", "`rate_limited`", "`request-budget`"]) expect(section("## Exit codes")).toContain(code);
  });
});

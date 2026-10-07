import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configDir, credentialsPath } from "../src/credentials.js";
import { fakeFetch, KEY, tempHome, uks } from "./helpers.js";
import { me } from "./fixtures.js";

describe("credentials path", () => {
  it("POSIX: ~/.config/uks, or $XDG_CONFIG_HOME/uks when absolute", () => {
    expect(configDir({ platform: "linux", homedir: "/home/a", env: {} })).toBe(join("/home/a", ".config", "uks"));
    expect(configDir({ platform: "darwin", homedir: "/home/a", env: { XDG_CONFIG_HOME: "/x" } })).toBe(join("/x", "uks"));
    expect(configDir({ platform: "linux", homedir: "/home/a", env: { XDG_CONFIG_HOME: "relative" } })).toBe(join("/home/a", ".config", "uks"));
  });

  it("Windows: %APPDATA%\\uks", () => {
    expect(credentialsPath({ platform: "win32", homedir: "C:\\Users\\a", env: { APPDATA: "C:\\Users\\a\\AppData\\Roaming" } })).toBe(
      join("C:\\Users\\a\\AppData\\Roaming", "uks", "credentials.json"),
    );
  });
});

describe("login / logout", () => {
  it("login stores the key, whoami uses it, logout removes it", async () => {
    const home = tempHome();
    const login = await uks(["login", "--key", KEY], { home });
    expect(login.code).toBe(0);
    expect(login.stdout).not.toContain(KEY);
    const path = join(home, ".config", "uks", "credentials.json");
    expect(JSON.parse(readFileSync(path, "utf8")).api_key).toBe(KEY);

    const f = fakeFetch({ body: me() });
    const who = await uks(["whoami"], { home, fetch: f.fetch });
    expect(who.code).toBe(0);
    expect(f.calls[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(who.stdout).toMatch(/Key from:\s+credentials file/);

    const out = await uks(["logout", "--json"], { home });
    expect(out.code).toBe(0);
    expect(out.json()).toMatchObject({ ok: true, removed: true });
    expect(existsSync(path)).toBe(false);
    expect((await uks(["whoami"], { home, fetch: f.fetch })).code).toBe(1);
    expect((await uks(["logout", "--json"], { home })).json().removed).toBe(false);
  });

  it.skipIf(process.platform === "win32")("writes the file 0600 and the directory 0700 on POSIX", async () => {
    const home = tempHome();
    await uks(["login", "--key", KEY], { home });
    const dir = join(home, ".config", "uks");
    expect(statSync(join(dir, "credentials.json")).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it.skipIf(process.platform === "win32")("re-applies 0700 to a uks directory that already exists with looser permissions", async () => {
    const home = tempHome();
    const dir = join(home, ".config", "uks");
    mkdirSync(dir, { recursive: true, mode: 0o755 });
    chmodSync(dir, 0o755);
    await uks(["login", "--key", KEY], { home });
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it("a failed rename leaves no temp file behind", async () => {
    const home = tempHome();
    const dir = join(home, ".config", "uks");
    // A directory where the credentials file should go makes the rename fail.
    mkdirSync(join(dir, "credentials.json"), { recursive: true });
    const r = await uks(["login", "--key", KEY], { home });
    expect(r.code).toBe(2);
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("on win32 the file goes under %APPDATA%\\uks", async () => {
    const home = tempHome();
    const r = await uks(["login", "--key", KEY, "--json"], { home, platform: "win32" });
    expect(r.code).toBe(0);
    expect(r.json().path).toBe(join(home, "AppData", "Roaming", "uks", "credentials.json"));
  });

  it("UKS_API_KEY wins over the saved key", async () => {
    const home = tempHome();
    await uks(["login", "--key", "uk_live_SAVEDKEY"], { home });
    const f = fakeFetch({ body: me() });
    await uks(["whoami"], { home, fetch: f.fetch, env: { UKS_API_KEY: KEY } });
    expect(f.calls[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("--key - reads the key from stdin", async () => {
    const home = tempHome();
    const r = await uks(["login", "--key", "-"], { home, stdin: `${KEY}\n` });
    expect(r.code).toBe(0);
    expect(JSON.parse(readFileSync(join(home, ".config", "uks", "credentials.json"), "utf8")).api_key).toBe(KEY);
  });

  it("rejects a malformed key without saving or echoing it", async () => {
    const home = tempHome();
    const r = await uks(["login", "--key", "sk_live_not_ours"], { home });
    expect(r.code).toBe(2);
    expect(r.stderr).not.toContain("sk_live_not_ours");
    expect(existsSync(join(home, ".config", "uks", "credentials.json"))).toBe(false);
  });

  it("login without --key exits 2", async () => {
    expect((await uks(["login"])).code).toBe(2);
  });

  it("a corrupt credentials file exits 2 with a fix, and logout still clears it", async () => {
    const home = tempHome();
    const dir = join(home, ".config", "uks");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "credentials.json"), "{not json");
    const r = await uks(["whoami"], { home, fetch: fakeFetch({ body: me() }).fetch });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("uks logout");
    expect((await uks(["logout"], { home })).code).toBe(0);
    expect(existsSync(join(dir, "credentials.json"))).toBe(false);
  });
});

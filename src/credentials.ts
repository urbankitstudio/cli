import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { ACCOUNT_URL, type Deps } from "./context.js";
import { CliError, EXIT } from "./errors.js";

export const KEY_PATTERN = /^uk_live_[A-Za-z0-9_-]+$/;

export type KeySource = "env" | "file";

export interface ResolvedKey {
  key: string;
  source: KeySource;
}

/** `%APPDATA%\uks` on Windows, else `$XDG_CONFIG_HOME/uks` or `~/.config/uks`. */
export function configDir(deps: Pick<Deps, "env" | "platform" | "homedir">): string {
  if (deps.platform === "win32") {
    const appData = deps.env.APPDATA;
    return join(appData && appData.trim() ? appData : join(deps.homedir, "AppData", "Roaming"), "uks");
  }
  const xdg = deps.env.XDG_CONFIG_HOME;
  return join(xdg && isAbsolute(xdg) ? xdg : join(deps.homedir, ".config"), "uks");
}

export function credentialsPath(deps: Pick<Deps, "env" | "platform" | "homedir">): string {
  return join(configDir(deps), "credentials.json");
}

interface CredentialsFile {
  version: 1;
  api_key: string;
  saved_at: string;
}

async function readStored(deps: Deps): Promise<string | null> {
  const path = credentialsPath(deps);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new CliError(EXIT.FAILED, "credentials-unreadable", `Could not read ${path}: ${(err as Error).message}`);
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CredentialsFile>;
    if (typeof parsed.api_key === "string" && KEY_PATTERN.test(parsed.api_key)) return parsed.api_key;
  } catch {
    // fall through to the same error as a well-formed file with no key
  }
  throw new CliError(
    EXIT.FAILED,
    "credentials-invalid",
    `${path} does not hold a valid key. Run \`uks logout\`, then \`uks login --key uk_live_...\`.`,
  );
}

/** UKS_API_KEY wins; otherwise the credentials file; otherwise null. */
export async function resolveKey(deps: Deps): Promise<ResolvedKey | null> {
  const fromEnv = deps.env.UKS_API_KEY?.trim();
  if (fromEnv) {
    if (!KEY_PATTERN.test(fromEnv)) {
      throw new CliError(EXIT.FAILED, "bad-key-format", "UKS_API_KEY is set but is not a uk_live_ key.");
    }
    return { key: fromEnv, source: "env" };
  }
  const stored = await readStored(deps);
  return stored ? { key: stored, source: "file" } : null;
}

export async function requireKey(deps: Deps): Promise<ResolvedKey> {
  const found = await resolveKey(deps);
  if (found) return found;
  throw new CliError(
    EXIT.REFUSED,
    "missing-key",
    `This command needs an API key. Run \`uks login --key uk_live_...\` or set UKS_API_KEY. Create a key at ${ACCOUNT_URL} (free tier).`,
  );
}

/**
 * Writes the key via a temp file and a rename. On POSIX the file is 0600 and the
 * directory 0700, re-applied when the directory already exists. On Windows no
 * ACL is set: the file inherits the folder's.
 */
export async function saveKey(deps: Deps, key: string): Promise<string> {
  const dir = configDir(deps);
  const path = credentialsPath(deps);
  const body: CredentialsFile = { version: 1, api_key: key, saved_at: deps.now().toISOString() };
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (deps.platform !== "win32") await chmod(dir, 0o700);
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(body, null, 2) + "\n", { mode: 0o600 });
  try {
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  if (deps.platform !== "win32") await chmod(path, 0o600);
  return path;
}

/** True when a file was removed. */
export async function removeKey(deps: Deps): Promise<boolean> {
  const path = credentialsPath(deps);
  try {
    await readFile(path);
  } catch {
    return false;
  }
  await rm(path, { force: true });
  return true;
}

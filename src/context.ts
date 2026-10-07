/** Everything the CLI touches outside its own code, injectable so tests never hit the network or the real home directory. */
export interface Deps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Reads all of stdin. Used only by `login --key -`. */
  readStdin: () => Promise<string>;
  platform: NodeJS.Platform;
  homedir: string;
  now: () => Date;
}

export interface Context {
  deps: Deps;
  json: boolean;
  quiet: boolean;
  apiBase: string;
}

export const DEFAULT_API_BASE = "https://urbankitstudio.com";
export const SITE = "https://urbankitstudio.com";
export const ACCOUNT_URL = `${SITE}/account`;

/** Write one JSON document (with --json) or the human rendering. */
export function emit(ctx: Context, doc: unknown, human: () => string): void {
  if (ctx.json) {
    ctx.deps.stdout(JSON.stringify(doc, null, 2) + "\n");
    return;
  }
  const text = human();
  if (text) ctx.deps.stdout(text.endsWith("\n") ? text : text + "\n");
}

/** A side note for a person: stderr, dropped by --quiet and by --json. */
export function notice(ctx: Context, text: string): void {
  if (ctx.quiet || ctx.json) return;
  ctx.deps.stderr(text.endsWith("\n") ? text : text + "\n");
}

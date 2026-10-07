import type { Context } from "../context.js";
import { ACCOUNT_URL, emit, notice } from "../context.js";
import { credentialsPath, KEY_PATTERN, removeKey, saveKey } from "../credentials.js";
import { EXIT, usageError } from "../errors.js";

export async function loginCommand(ctx: Context, opts: { key?: string }): Promise<number> {
  if (opts.key === undefined) {
    throw usageError(`login needs --key uk_live_... (or --key - to read it from stdin). Create a key at ${ACCOUNT_URL} (free tier).`);
  }
  const key = (opts.key === "-" ? await ctx.deps.readStdin() : opts.key).trim();
  if (!KEY_PATTERN.test(key)) {
    throw usageError("That is not a UrbanKit API key. Keys start with uk_live_ and contain only letters, digits, '_' and '-'.");
  }
  const path = await saveKey(ctx.deps, key);
  emit(ctx, { ok: true, saved: true, path }, () => `Key saved to ${path}. Check it with \`uks whoami\`.`);
  if (ctx.deps.env.UKS_API_KEY?.trim()) notice(ctx, "uks: note: UKS_API_KEY is set and takes precedence over the saved key.");
  return EXIT.OK;
}

export async function logoutCommand(ctx: Context): Promise<number> {
  const removed = await removeKey(ctx.deps);
  const path = credentialsPath(ctx.deps);
  emit(ctx, { ok: true, removed, path }, () => (removed ? `Removed the saved key (${path}).` : "No saved key to remove."));
  if (ctx.deps.env.UKS_API_KEY?.trim()) notice(ctx, "uks: note: UKS_API_KEY is still set in this environment, so commands still send a key.");
  return EXIT.OK;
}

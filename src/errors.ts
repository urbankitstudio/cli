// Exit codes follow clig.dev: 0 success, 1 refused, 2 could not run, 3 quota
// exhausted. Nothing here ever exits 126 or above, which shells reserve.
export const EXIT = {
  OK: 0,
  /** A key the server rejects (401/402/403), no key where one is required, or the plan lacks the entitlement. */
  REFUSED: 1,
  /** Bad arguments, network failure, a request the server rejects (other 4xx), a 5xx, or a response the CLI cannot read. */
  FAILED: 2,
  /** 429: a rate limit, the key's quota, or the county-request budget is spent. */
  QUOTA: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/**
 * An expected failure with a stable machine code. `extra` is merged into the
 * --json error document, so it carries what an agent needs to act (reset time,
 * an upgrade link when the server sent one, the HTTP status).
 */
export class CliError extends Error {
  constructor(
    readonly exitCode: ExitCode,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CliError";
  }
}

export function usageError(message: string): CliError {
  return new CliError(EXIT.FAILED, "bad-arguments", message);
}

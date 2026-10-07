import { parseArgs, type ParseArgsConfig } from "node:util";
import { loginCommand, logoutCommand } from "./commands/auth.js";
import { lookupCommand, requestCountyCommand } from "./commands/atlas-api.js";
import { plansCommand, usageCommand, whoamiCommand } from "./commands/account.js";
import { countyCommand, findCommand, statesCommand } from "./commands/offline.js";
import type { Context, Deps } from "./context.js";
import { DEFAULT_API_BASE, emit } from "./context.js";
import { CliError, EXIT, usageError } from "./errors.js";
import { normalizeApiBase } from "./http.js";
import { CLI_VERSION, versionInfo } from "./version.js";

type Opts = Record<string, string | boolean | undefined>;

interface Command {
  summary: string;
  usage: string;
  /** Command-specific options, beyond the global ones. */
  options: string[];
  details: string;
  run: (ctx: Context, positionals: string[], opts: Opts) => Promise<number>;
}

const s = (v: unknown) => (typeof v === "string" ? v : undefined);

const COMMANDS: Record<string, Command> = {
  plans: {
    summary: "List the plans: price, quota, window, owner data (no key needed)",
    usage: "uks plans [--json]",
    options: [],
    details: "Calls GET /api/v1/plans. No key needed.",
    run: (ctx) => plansCommand(ctx),
  },
  whoami: {
    summary: "Show your key's tier, quota and subscription",
    usage: "uks whoami [--json]",
    options: [],
    details: "Calls GET /api/v1/me with your key. Shows only the server's key prefix, never the key.",
    run: (ctx) => whoamiCommand(ctx),
  },
  usage: {
    summary: "Show calls and units by endpoint and by day",
    usage: "uks usage [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--json]",
    options: ["from", "to"],
    details: "Calls GET /api/v1/usage with your key. Without dates the server picks the range.",
    run: (ctx, _p, o) => usageCommand(ctx, { from: s(o.from), to: s(o.to) }),
  },
  states: {
    summary: "List the states the atlas covers (offline)",
    usage: "uks states [--json]",
    options: [],
    details: "Reads the atlas data bundled with the CLI. No network.",
    run: (ctx) => statesCommand(ctx),
  },
  find: {
    summary: "Find counties by name, state or FIPS (offline)",
    usage: 'uks find <query> [--limit N] [--json]   e.g. uks find "Kane IL", uks find 17089',
    options: ["limit"],
    details:
      "Matches the county name (exact, prefix, contains, then near spellings), optionally narrowed by a trailing state name or two-letter code. A 5-digit query is a FIPS lookup. Reads the bundled atlas data; no network.",
    run: (ctx, p, o) => findCommand(ctx, p, { limit: s(o.limit) }),
  },
  county: {
    summary: "Show one county's REST endpoint record (offline)",
    usage: "uks county <state> <county> [--json]   or   uks county <FIPS>",
    options: [],
    details:
      "State: slug, name or two-letter code. County: slug (kane-county) or name (Kane). Prints the service URL, layer, owner field (or why there is none), the scope predicate on a shared layer, and an UrbanKit link. Endpoint status is the publish-time stamp; live_status_url gives the current one. A county not in the atlas is a normal answer (found: false, exit 0) with the request-county command to ask for it.",
    run: (ctx, p) => countyCommand(ctx, p),
  },
  lookup: {
    summary: "Resolve a street address to its county and parcel endpoint",
    usage: 'uks lookup "<street, city, state>" [--json]',
    options: [],
    details:
      "Calls GET /api/atlas/lookup. Works without a key at the anonymous per-IP limit; with a key (UKS_API_KEY or `uks login`) the key's quota applies and each call counts one unit. A miss is a normal answer (exit 0).",
    run: (ctx, p) => lookupCommand(ctx, p),
  },
  "request-county": {
    summary: "Ask UrbanKit to add a county that is not in the atlas (free)",
    usage:
      "uks request-county (--fips 06003 | --state <state-slug> --county <county-slug>) [--email you@example.com] [--note text] [--source-url https://...]",
    options: ["fips", "state", "county", "email", "note", "source-url"],
    details:
      "Calls POST /api/atlas/request. Free, no key needed and none is sent. Slugs are strict: lowercase a-z and 0-9 with single hyphens (illinois, kane-county). The email is used only to tell you when the county ships. Repeating the same request within 24 hours returns the first request's id rather than a new one. Limited to 5 requests per hour per IP address.",
    run: (ctx, _p, o) =>
      requestCountyCommand(ctx, {
        fips: s(o.fips),
        state: s(o.state),
        county: s(o.county),
        email: s(o.email),
        note: s(o.note),
        "source-url": s(o["source-url"]),
      }),
  },
  login: {
    summary: "Save an API key for later commands",
    usage: "uks login --key uk_live_...   (or --key - to read the key from stdin)",
    options: ["key"],
    details:
      "Writes the key to ~/.config/uks/credentials.json (%APPDATA%\\uks\\credentials.json on Windows), owner-only (0600) on POSIX. UKS_API_KEY, when set, takes precedence. The key is not checked against the server; run `uks whoami` for that.",
    run: (ctx, _p, o) => loginCommand(ctx, { key: s(o.key) }),
  },
  logout: {
    summary: "Remove the saved API key",
    usage: "uks logout",
    options: [],
    details: "Deletes the credentials file. Does not touch UKS_API_KEY.",
    run: (ctx) => logoutCommand(ctx),
  },
};

const GLOBAL_OPTIONS = ["json", "quiet", "help", "version", "api-base"];

const PARSE_OPTIONS: NonNullable<ParseArgsConfig["options"]> = {
  json: { type: "boolean" },
  quiet: { type: "boolean", short: "q" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "V" },
  "api-base": { type: "string" },
  from: { type: "string" },
  to: { type: "string" },
  limit: { type: "string" },
  fips: { type: "string" },
  state: { type: "string" },
  county: { type: "string" },
  email: { type: "string" },
  note: { type: "string" },
  "source-url": { type: "string" },
  key: { type: "string" },
};

const GLOBAL_HELP = `Global flags:
  --json             Print one JSON document on stdout (errors too)
  -q, --quiet        Drop notes and hints on stderr
  --api-base <url>   API origin (default ${DEFAULT_API_BASE}; env UKS_API_BASE)
  -h, --help         Help for uks or for one command
  -V, --version      Print the CLI version and the atlas data it carries`;

export function mainHelp(): string {
  const width = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  const list = Object.entries(COMMANDS)
    .map(([name, c]) => `  ${name.padEnd(width)}  ${c.summary}`)
    .join("\n");
  return `uks ${CLI_VERSION}: the UrbanKit Studio command line

Usage: uks <command> [options]

Commands:
${list}

${GLOBAL_HELP}

Environment:
  UKS_API_KEY        API key (wins over the saved one)
  UKS_API_BASE       API origin, same as --api-base
  NO_COLOR           Accepted. uks never prints color

Exit codes:
  0  success
  1  refused: no key, a key the server rejects (401/402/403), or a plan without the feature
  2  could not run: bad arguments, network failure, a request the server rejects (other 4xx), a server error (5xx)
  3  rate limit, quota or county-request budget exhausted (429): the reset time is on stderr and in --json

Run \`uks <command> --help\` for one command.`;
}

function commandHelp(c: Command): string {
  return `${c.summary}

Usage: ${c.usage}

${c.details}

${GLOBAL_HELP}`;
}

function parse(argv: string[]) {
  try {
    return parseArgs({ args: argv, options: PARSE_OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    throw usageError(`${msg} Run \`uks --help\`.`);
  }
}

function writeError(deps: Deps, json: boolean, err: CliError): void {
  deps.stderr(`uks: ${err.message}\n`);
  if (json) {
    deps.stdout(
      JSON.stringify({ ok: false, error: err.code, message: err.message, exit_code: err.exitCode, ...err.extra }, null, 2) + "\n",
    );
  }
}

/** Runs one invocation and returns its exit code. Never throws. */
export async function run(argv: string[], deps: Deps): Promise<number> {
  // Read --json before full parsing so even an argument error answers in JSON.
  const wantsJson = argv.includes("--json");
  try {
    const { values, positionals } = parse(argv);
    const opts = values as Opts;
    const json = opts.json === true;
    const ctx: Context = {
      deps,
      json,
      quiet: opts.quiet === true,
      apiBase: normalizeApiBase(s(opts["api-base"]) ?? (deps.env.UKS_API_BASE?.trim() || DEFAULT_API_BASE)),
    };

    const [name, ...rest] = positionals;
    if (name === "help") {
      const target = rest[0];
      if (!target) {
        deps.stdout(mainHelp() + "\n");
        return EXIT.OK;
      }
      const c = COMMANDS[target];
      if (!c) throw usageError(`Unknown command '${target}'. Run \`uks --help\`.`);
      deps.stdout(commandHelp(c) + "\n");
      return EXIT.OK;
    }
    if (opts.version === true && !name) {
      const info = versionInfo();
      emit(ctx, { ok: true, ...info }, () =>
        `uks ${info.cli} (atlas ${info.atlas_package ?? "unknown"}, data updated ${info.atlas_data.last_updated}; ${info.atlas_data.totals.counties} counties)`,
      );
      return EXIT.OK;
    }
    if (!name) {
      deps.stdout(mainHelp() + "\n");
      return EXIT.OK;
    }
    const command = COMMANDS[name];
    if (!command) throw usageError(`Unknown command '${name}'. Run \`uks --help\`.`);
    if (opts.help === true) {
      deps.stdout(commandHelp(command) + "\n");
      return EXIT.OK;
    }
    const allowed = new Set([...GLOBAL_OPTIONS, ...command.options]);
    for (const key of Object.keys(opts)) {
      if (!allowed.has(key)) throw usageError(`'${name}' does not take --${key}. Run \`uks ${name} --help\`.`);
    }
    const takesPositionals = ["find", "county", "lookup"].includes(name);
    if (!takesPositionals && rest.length > 0) {
      throw usageError(`'${name}' takes no arguments, got '${rest.join(" ")}'. Run \`uks ${name} --help\`.`);
    }
    return await command.run(ctx, rest, opts);
  } catch (err) {
    if (err instanceof CliError) {
      writeError(deps, wantsJson, err);
      return err.exitCode;
    }
    const message = err instanceof Error ? err.message : String(err);
    const internal = new CliError(EXIT.FAILED, "internal-error", `Unexpected error: ${message}`);
    writeError(deps, wantsJson, internal);
    if (deps.env.UKS_DEBUG && err instanceof Error && err.stack) deps.stderr(err.stack + "\n");
    return EXIT.FAILED;
  }
}

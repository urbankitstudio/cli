# @urbankitstudio/cli

`uks` is the UrbanKit Studio command line. It lists plans, shows your key's quota and usage, resolves an
address to its county's parcel endpoint, and files a request for a county the atlas lacks. County search runs
offline against the bundled County Parcel REST API Atlas data. Every command prints one JSON document with
`--json` and exits with a code a script can branch on.

Node.js 22 or newer. The only runtime dependency is
[`@urbankitstudio/atlas`](https://www.npmjs.com/package/@urbankitstudio/atlas), which supplies the offline data.

## Install

```sh
npx @urbankitstudio/cli --help      # run once without installing
npm install -g @urbankitstudio/cli  # or install the uks command
uks --help
```

From the monorepo, for development:

```sh
npm --prefix packages/cli ci
npm --prefix packages/cli exec -- tsup --config packages/cli/tsup.config.ts
node packages/cli/dist/uks.js --help
```

## Commands

| Command | Network | Key | What it does |
|---|---|---|---|
| `uks plans` | yes | no | Plans: price, quota, window, owner data |
| `uks whoami` | yes | yes | Your tier, key prefix and label, quota, subscription |
| `uks usage [--from D] [--to D]` | yes | yes | Calls and units in total, by endpoint, by day |
| `uks states` | no | no | States the atlas covers, with county and endpoint counts |
| `uks find <query> [--limit N]` | no | no | Counties by name, name plus state, or FIPS |
| `uks county <state> <county>` | no | no | One county's endpoint record (also `uks county <FIPS>`) |
| `uks lookup "<address>"` | yes | optional | Address to county and parcel endpoint |
| `uks request-county ...` | yes | no | Ask for a county the atlas lacks (free) |
| `uks login --key uk_live_...` | no | no | Save a key |
| `uks logout` | no | no | Remove the saved key |

### Examples

```sh
uks plans
uks whoami --json
uks usage --from 2026-10-01 --to 2026-10-06
uks states
uks find "Kane IL"
uks county illinois kane-county
uks lookup "100 S 3rd St, Geneva, IL"
uks request-county --fips 06003 --email you@example.com
uks login --key uk_live_xxxxxxxx
uks logout
uks --version
```

### Notes per command

- **find** matches the county name exactly, then by prefix, then by substring, then by a near spelling. A
  trailing state name or two-letter code narrows it ("Kane IL", "Kane County, Illinois"). A 5-digit query is
  a FIPS lookup. A query that matches no county but is a state name lists that state's counties. Any miss
  is a normal answer: `found: false`, exit 0, and a `request` hint. A name miss without a state gives a
  `request` body with a `missing` list and placeholders in the command.
- **county** takes the state as a slug, a name or a two-letter code, and the county as a slug (`kane-county`)
  or a name (`Kane`). It prints each endpoint's service URL and layer, the owner-name column or the reason
  there is none, the scope predicate (`scope_where`) when the layer serves several counties, whether the
  layer takes attribute search or only spatial queries, and a link into the UrbanKit parcel lookup tool. The
  endpoint `status` is the stamp from when the atlas package was published; `live_status_url` gives the
  current answer. A county that is not in the atlas is a normal answer: `found: false`, exit 0, and the
  `request-county` command that asks for it.
- **lookup** works without a key at the anonymous per-IP limit. With a key, the key's quota applies and each
  call counts one unit. A miss (`matched: false`) or a county the atlas lacks (`atlas_indexed: false`) is a
  normal answer, exit 0.
- **request-county** names the county by `--fips 06003`, or by `--state <slug> --county <slug>`. Slugs are
  strict: lowercase `a-z` and `0-9` with single hyphens (`illinois`, `kane-county`). `--email`, `--note`
  and `--source-url` (https only) are optional. The email is used only to tell you when the county ships.
  Repeating the same request within 24 hours returns the first request's id. It is free, needs no key, and
  sends none. Limited to 5 requests per hour per IP address.
- **login** writes the key to `~/.config/uks/credentials.json`, or to `$XDG_CONFIG_HOME/uks/` when that is
  an absolute path, or to `%APPDATA%\uks\credentials.json` on Windows. On Linux and macOS the file is
  readable only by you (0600) and the folder is 0700. On Windows no ACL is set, so the file inherits the
  folder's permissions. `--key -` reads the key from stdin, which keeps it out of your shell history. The key
  is not checked against the server. `uks whoami` does that.

## Global flags

| Flag | Meaning |
|---|---|
| `--json` | Print one JSON document on stdout, errors included |
| `-q`, `--quiet` | Drop notes and hints on stderr |
| `--api-base <url>` | API origin, default `https://urbankitstudio.com` |
| `-h`, `--help` | Help for `uks` or for one command |
| `-V`, `--version` | CLI version and the atlas data version it carries |

`uks` never prints color, so `NO_COLOR` and a non-TTY stdout need nothing special. It refuses to send a key
over plain `http` to anything but a loopback address (`localhost`, `::1`, `127.0.0.0/8`).

## Environment

| Variable | Meaning |
|---|---|
| `UKS_API_KEY` | API key; wins over the saved one |
| `UKS_API_BASE` | API origin, same as `--api-base` (the flag wins) |
| `XDG_CONFIG_HOME` | Where the credentials file goes on Linux and macOS, when it is an absolute path |
| `UKS_DEBUG` | Print a stack trace on an unexpected internal error |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success, including "no match" and "not in the atlas" answers |
| 1 | Refused: no key where one is needed, a key the server rejects (401/402/403), or a plan without the feature |
| 2 | Could not run: bad arguments, a network failure, a request the server rejects (other 4xx), a server error (5xx), an unreadable response |
| 3 | Rate limit, quota or county-request budget exhausted (429) |

A 429 carries one of three `error` strings:

| `error` | From | Meaning |
|---|---|---|
| `rate-limited` | `whoami`, `usage`, `request-county` | The per-IP limit (60 per minute on the account routes, 5 per hour for county requests). Not your quota. |
| `rate_limited` | `lookup` | The key's quota, or the anonymous per-IP limit without a key. |
| `request-budget` | `request-county` | The daily budget for county requests is spent. The request was not stored. |

The reset time goes to stderr and, with `--json`, into the error document as `reset_at`,
`retry_after_seconds`, `limit` and `remaining`. `upgrade_url` is present only on a `lookup` quota 429
(`rate_limited`), because only that body carries one.

## For agents

- Pass `--json` on every call. Success prints the server's document unchanged for `plans`, `whoami`, `usage`,
  `lookup` and `request-county`, and the CLI's own document for `states`, `find`, `county`, `login`, `logout`
  and `--version`.
- An error with `--json` prints `{"ok": false, "error": "<code>", "message": "...", "exit_code": N, ...}` on
  stdout and one line on stderr. Branch on `error` and the exit code, never on `message`.
- Set `UKS_API_KEY` in the environment rather than running `uks login`.
- Exit 3 means wait until `reset_at`, or upgrade at `upgrade_url` when it is present.
- Exit 2 from a network failure or a 5xx is worth one retry. Exit 2 with error "bad-arguments" is not. Fix the
  call. Exit 1 is not retryable.
- `states`, `find` and `county` never touch the network, so they are free and work offline.

## License

MIT

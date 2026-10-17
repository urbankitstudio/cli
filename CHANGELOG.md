# @urbankitstudio/cli Changelog

## 0.1.3 (2026-10-14)

- `lookup` takes `--op <operation_id>`, sent as `?op=`. A pay-as-you-go lookup whose billing could not be
  confirmed answers 402 with an `operation_id`; retrying the same address with it within 20 hours of the
  original request is never billed twice. The id contains a `|`, so quote it in the shell. A value that is
  not an operation id is refused locally (exit 2, `bad-arguments`), because the server would ignore it and
  bill a new lookup.
- A 402 that carries an `operation_id` prints it, with the `--op` retry, and `--json` puts it in the error
  document as a top-level `operation_id`. The exit code is unchanged (1).
- The server binds an operation id to the address it was issued for. With `--op` and a different address,
  a chargeable answer is refused and nothing is billed, and an answer that is not chargeable is returned as
  if no `--op` were sent.

## 0.1.2 (2026-10-13)

- `county` and `find` documents carry `pagination` (`"supported"` or `"unsupported"`) and `max_record_count` per
  endpoint, read from the atlas record's `supportsPagination` and `maxRecordCount` (published on the two
  Mississippi statewide layers from `@urbankitstudio/atlas` 0.6.30). On a layer that refuses pagination the
  `search_note` ends with the same sentences the hosted MCP writes: send one request without
  `resultRecordCount` or `resultOffset`, read at most `max_record_count` rows, and narrow the query when
  `exceededTransferLimit` is set, since no page 2 exists.
- `county` and `lookup` human output print a `Pagination` row and that note for such a layer, and nothing new
  for a layer that pages.
- No `uks` command sends an ArcGIS query itself; the documents above are how the CLI honours the flag.
- The dependency range moves to `^0.6.30`, the atlas release that defines the two keys. They are still read
  structurally, so older data, where every layer pages, keeps working.

## 0.1.1 (2026-10-10)

- The `bin` entry is `dist/uks.js` (no leading `./`), the form npm normalizes to, so `npm publish` no longer warns that it auto-corrected `package.json`. The `uks` command was installed either way.
- The README's install section shows the published package.
- First release published from `urbankitstudio/cli` over npm Trusted Publishing (OIDC), with provenance.

## 0.1.0 (2026-10-10)

First version of `uks`, the UrbanKit Studio command line.

### Commands

- `plans`, `whoami`, `usage` read the v1 account API (`/api/v1/plans`, `/api/v1/me`, `/api/v1/usage`).
- `states`, `find`, `county` answer offline from the bundled `@urbankitstudio/atlas` data (`^0.6.19`).
- `lookup` calls `GET /api/atlas/lookup`, keyless or keyed.
- `request-county` calls `POST /api/atlas/request`, free and keyless.
- `login` and `logout` manage a saved key; `UKS_API_KEY` takes precedence.

### Conventions

- `--json` prints one JSON document on stdout, for errors too.
- Exit codes: 0 success, 1 refused, 2 could not run, 3 rate limit, quota or county-request budget exhausted.
- `--api-base` and `UKS_API_BASE` point the CLI at another origin. A key is never sent over plain http
  except to a loopback address (localhost, ::1, 127.0.0.0/8).

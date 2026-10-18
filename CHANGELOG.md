# @urbankitstudio/cli Changelog

## 0.1.5 (2026-10-18)

- `lookup` for a county that is paused (its terms or a law forbid paid use) prints the hosted answer's paused
  `coverage` block: what is paused (the preset, and the `Surfaces` by name), `Why`, `Terms` (the citation), `Since`, the county office and the free county
  page. `--json` passes the block through unchanged (`status: "paused"`, `preset`, `paused`, `reason`, `why`,
  `citation_url`, `since`, `county_office`, `free_alternatives`, `request: null`). A paused lookup is not billed.
- `src/access-core.ts` is a copy of `@urbankitstudio/atlas`'s paused-answer core (0.6.39), written by the monorepo's
  sync, until the dependency floor reaches the release that exports it. Offline commands are unchanged: which
  counties are paused is live data from the hosted API.
- `src/coverage-core.ts` (the synced copy of the atlas coverage core) drops an apostrophe from a county name in the
  `request` hint, as `@urbankitstudio/atlas` 0.6.39 does: `Prince George's` gives `prince-georges-county`.

## 0.1.4 (2026-10-17)

- `county` and `find` documents for a county we do not serve carry a `coverage` block: `status`
  (`"not-in-atlas"` for a county the atlas lacks, which may also be a misspelled name, `"no-public-data"` for
  one recorded with no public parcel endpoint), `reason`, `why`, `checked`, `recheck` (the next planned check,
  or null), `county_office`, `county_product` (the county's own paid channel, only when it sells the data),
  `request` and `message`, the whole block as
  text. The top-level `request` is that same object, so either can be POSTed. The block is the one the hosted
  API and MCP tools return, built by the same code (`src/coverage-core.ts`, a copy of `@urbankitstudio/atlas`'s
  `coverageAnswer` until the dependency floor reaches the release that exports it).
- The request body is the one every surface builds for the same county: `county_fips` with `county_name` and
  `state_abbrev` when the code is known, otherwise `state_slug` and `county_slug`, the same however the name
  was typed. The request `message` is the shared text the API and MCP tools send, and for a county with
  no public data it says we recheck such counties without promising to add them. The CLI's own `command` and
  `missing` fields stay.
- Human output for such a county, from `county`, `find` and `lookup`, prints the block's `message` verbatim:
  why, the check date and the next one, the county office and product, a spelling check for a name the atlas
  lacks, and how to request the county. A hosted answer that predates `message` still gets the `Why`, `Checked`,
  `County office`, `County product` and `Request it (free)` rows.
- `lookup` help and README: a keyed call for a county we do not serve, or one that fails on our side, no
  longer keeps its quota unit.
- A fourth 429 reaches `lookup`: `unbilled-limit`, sent once an account (all of its keys together) has made
  as many lookups in a UTC day that charged nothing as its quota number, at most 10,000 (500 on Free). A
  charged call never counts, nor does an upstream outage (a 502, 503 or 504; a 500 counts), a pay-as-you-go
  answer for a served county from a stale cached geocode, or a pay-as-you-go 402 `usage_not_recorded` other
  than one whose `op` token was minted for another address or another tool. It exits 3 like the others, with
  the server's message, the cap in `limit` and the body's `reset` (the next 00:00 UTC) in `reset_at`; the
  README's exit-code table lists it.

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

# @urbankitstudio/cli Changelog

## 0.1.0 (unreleased)

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

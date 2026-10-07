# packages/cli: rules for sessions working on @urbankitstudio/cli

## What this package is
- `@urbankitstudio/cli` on npm, binary `uks`: the command-line client for UrbanKit Studio. It is one of the
  agent surfaces, beside `@urbankitstudio/atlas` (data + SDK), the stdio MCP server `@urbankitstudio/mcp-atlas`
  and the hosted MCP (`api/mcp.ts` in the monorepo).
- Account commands call the v1 API (`api/v1/*`). `lookup` and `request-county` call the public atlas routes
  documented in `public/openapi.json`. `states`, `find` and `county` read the `@urbankitstudio/atlas` package
  and never touch the network.
- Its one runtime dependency is `@urbankitstudio/atlas`, kept external in the bundle so `uks --version`
  reports the atlas actually installed.

## Publishing
- Authored here and mirrored to the public repo `urbankitstudio/cli`, which publishes by npm Trusted
  Publishing (OIDC) on a version change, the same route `packages/atlas` takes. Release = bump the version
  and CHANGELOG here; never `npm publish` by hand (the one exception was the first version, 0.1.0).

## The order: agent first (Leo, 2026-09-26)
Every new county, tool, feature or fix reaches the agent surfaces FIRST, in the same change set. The paid
meter and tiers come second. The site's free-tools UI comes last. Procedure: the `agent-first-uks` skill.
A new API route or a changed response shape that this CLI calls moves the CLI in the same change.

## Release checklist
- [ ] A change to a command, a flag, an exit code or the `--json` shape bumps `version` in package.json AND
      adds a `CHANGELOG.md` entry, in the SAME PR.
- [ ] An `@urbankitstudio/atlas` release that changes record fields the `county` command reads gets a
      dependency bump here, with its own CHANGELOG entry.
- [ ] The search notes in `src/commands/offline.ts` are copied from the monorepo's
      `api/_lib/search-capability.ts`. A change there changes them here, in the same PR.
- [ ] `npm pack --dry-run` lists only `dist/`, `README.md`, `LICENSE`, `CHANGELOG.md` and `package.json`.

## Standing rules
- No `npm -g` and no global installs, ever; no `npx` for a binary absent from node_modules. Missing
  tooling is a blocker to report, not a thing to install.
- This package has its own node_modules and suite, outside the root `npm test`:
  `npm --prefix packages/cli ci`, then `npm --prefix packages/cli test` and `run typecheck`. Build with
  `npm --prefix packages/cli exec -- tsup --config packages/cli/tsup.config.ts` (the config resolves its
  paths from its own location, so any working directory gives the same `dist/uks.js`).
- Tests inject `fetch` and the home directory. A test that reaches the real network or the real home
  directory is a bug.
- Never print the key. `whoami` shows only the server's `key_prefix`; the redaction tests hold this.

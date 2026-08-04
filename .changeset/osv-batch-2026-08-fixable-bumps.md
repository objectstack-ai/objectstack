---
"@objectstack/plugin-hono-server": patch
---

ci(deps): OSV security batch 2026-08 — undici to 7.29.0, hono to 4.12.34,
fast-uri to 3.1.5, so `Validate Package Dependencies` stops failing on every PR (#5032)

Eight advisories (2 high, 6 medium) matched packages resolved in `main`'s
`pnpm-lock.yaml`, and all eight name a fixed version:

| advisory | CVSS | package | resolved | fixed |
| --- | --- | --- | --- | --- |
| `GHSA-7p8r-x3mc-p8w7` | 7.5 | `fast-uri` | 3.1.4 | 3.1.5 |
| `GHSA-8j4g-w8fx-2239` | 5.3 | `hono` | 4.12.32, 4.12.33 | 4.12.34 |
| `GHSA-4cwx-7wf7-3272` | 7.4 | `undici` | 7.28.0 | 7.29.0 |
| `GHSA-jr45-8vmc-qm54` | 5.9 | `undici` | 7.28.0 | 7.29.0 |
| `GHSA-8xcm-r25x-g524` | 4.8 | `undici` | 7.28.0 | 7.29.0 |
| `GHSA-v3r7-h72x-cjcm` | 4.8 | `undici` | 7.28.0 | 7.29.0 |
| `GHSA-m8rv-5g2x-5cg5` | 4.2 | `undici` | 7.28.0 | 7.29.0 |

The OSV-Scanner step in `.github/workflows/validate-deps.yml` reads
`pnpm-lock.yaml` directly and exits non-zero on any match, so the job was red on
`main` itself and attached that red to every PR touching a manifest or the
lockfile, whatever the PR contained (observed on #5027, whose own lockfile delta
is three lines and resolves no new package). A permanently red gate is worse
than no gate: the next PR that really does introduce a vulnerable dependency
looks exactly like all the others.

`undici` repeats the trap #4945 taught. The existing pin
(`undici@>=7.23.0 <7.28.0: ^7.28.0`, added for `GHSA-vmh5-mc38-953g`) had
settled on 7.28.0 — the version these five advisories affect — and its exclusive
upper bound no longer covered it, so the override sat there doing nothing.
Selector and target move together, to `<7.29.0` / `^7.29.0`. Transitive-only via
`@vscode/vsce` > `cheerio`; `@ai-sdk/provider-utils` already resolved 7.29.0, so
the two dedupe onto one copy. `jsdom`'s `undici` 8.9.0 is outside the selector
and untouched.

`fast-uri` is transitive-only through `ajv@8.20.0` (declares `^3.0.1`), reaching
`@modelcontextprotocol/sdk`, `@objectstack/objectql`, `secretlint` and `table`;
a `fast-uri@<3.1.5: ^3.1.5` override covers all of them.

`hono` is the one that is not transitive-only, which is why this changeset
releases something. Two versions were resolved: 4.12.32 from our own packages
and 4.12.33 pulled by `@modelcontextprotocol/sdk`. The override moves the
transitive copy and the declared ranges move with it — `@objectstack/plugin-hono-server`
`dependencies.hono` to `^4.12.34` (the published-manifest change this patch
covers), plus the `@objectstack/hono` and `@objectstack/plugin-auth`
devDependencies. Overrides do not ship with published packages, so a declared
range left behind would mean downstream resolves a version CI never ran —
exactly what `scripts/check-override-consistency.mjs` exists to catch. The
`@objectstack/hono` **peer** range stays the permissive `^4.12.8` on purpose: a
peer states which host `hono` the adapter works against, and a host that pins an
old one owns that copy. After the bump the workspace resolves a single
`hono@4.12.34`.

Scope is the eight advisories #5032 lists and nothing else. #4965 (advisories
with no fix available, and the `osv-scanner.toml` exemption conventions that
answer them) is a separate question — every advisory here has a fix, so this is
an upgrade, not an exemption.

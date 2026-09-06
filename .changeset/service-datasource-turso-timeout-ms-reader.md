---
"@objectstack/service-datasource": patch
---

fix(service-datasource): the shared libSQL config builder reads the canonical `config.timeoutMs` (#16023, follow-up on #15680)

`buildTursoDriverConfig` — the ONE seam both libSQL loaders go through (#7314) —
still consulted `config.timeout` after #15680 renamed that authored key to
`timeoutMs` and tombstoned the old spelling. A turso datasource authored the
canonical way therefore reached the seam, matched nothing, and had its timeout
**silently dropped**: no diagnostic in any channel.

The reader now consults `config.timeoutMs`. The DRIVER key it lands on is
unchanged and still spelled `timeout` — `TursoDriverConfig.timeout` is
published-but-inert (#16024), and renaming an inert key would ratify it as real,
which is what ADR-0049 exists to prevent. So this seam is the one place the
authored and driver spellings differ, and it now says so.

## No fallback arm for the retired spelling — the seam's own precedent

Both sibling arms in `default-datasource-driver-factory.ts` already answer this
in the same words: sqlite's "`filename` is the whole contract … so no `??`
tolerance survives here", mongo's "`url` is the one spelling". A renamed
datasource config key reaches a reader already canonical from two directions —
authoring refuses the retired spelling at the door (`retiredKey()`: `tsc`
`never` plus a parse-time prescription), and a stored `sys_metadata` row replays
the full ADR-0087 chain including `retiredFromLoadPath` entries at
`loadDatasourceRows` / `loadDatasourceRow`, so the D2 conversion
`turso-config-timeout-to-timeout-ms` has rewritten the key before this table
sees it. A `??` arm would be a consumer-side dialect (Prime Directive #12) for a
spelling both doors have closed.

`authToken`'s legacy arm is not a counter-precedent: it is kept for a LIVE route
(host boot translating `OS_DATABASE_AUTH_TOKEN` into a config it constructs
itself, which never meets the authoring schema), not for a retired spelling.

## Why the covering test did not catch it, and what replaces it

`TursoConfigSource.config` is a bare string-keyed bag, so `tsc` cannot see a
rename through it — the tombstone's type channel, which caught the alias tables
elsewhere in this stack, does not reach here. And the covering test authored the
**retired** spelling at all three of its turso `config` sites, so it was green
for exactly the behaviour that had become wrong. A test that pins the retired
spelling cannot notice this class of bug.

The three sites now author the canonical spelling, and the file gains cases
DERIVED from the authoring contract rather than written against today's key
list: they read `TursoConfigSchema`'s own `retiredKey()` tombstones and assert
that (a) every canonical replacement is consulted by some reader, and (b) no
retired spelling is — probed at every JS type a reader could type-test, with a
vacuity guard so a mis-derived empty list fails instead of passing. They hold
for the next rename without being edited.

The two sibling pins that author the same spec — `packages/cli`'s driver
correspondence check and `packages/runtime`'s cross-loader convergence check —
move to the canonical spelling with it; their assertions read driver keys and
are unchanged.

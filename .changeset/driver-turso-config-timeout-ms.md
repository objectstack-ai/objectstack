---
"@objectstack/driver-turso": minor
---

feat(driver-turso)!: the published connection config names its timeout's unit (#15682, ruling B on #14478)

<!-- adr-0087: not-required (already-registered turso-config-timeout-to-timeout-ms) that protocol-18 conversion rewrites `datasources[].config.timeout` to `timeoutMs` for turso datasources, which is the same authored key this package's schema mirrors — a second entry would restate the same rewrite without converting anything more -->

**BREAKING** — `TursoConfigSchema`'s `timeout` is renamed to **`timeoutMs`**. The
value is unchanged: the same milliseconds, the same `min(0)` bound, the same
optionality.

`@objectstack/spec`'s own turso contract renamed the same authored key in
#15680. This package publishes a parallel schema for the same connection config
— the Spec / Studio metadata a host reads to expose Turso configuration UI — so
until now the two declarations of one setting disagreed on its spelling. They
agree again.

The unit was never in the key name, only in the describe prose, while
`sync.intervalSeconds` — the same shape, three keys above — already spelled its
own. One published config carrying both conventions is what made the bare name
dangerous rather than untidy: an author who has just written
`intervalSeconds: 30` has no reason to read `timeout: 30` as milliseconds, and
nothing in the schema, the type or the parse would have told them otherwise.

The old spelling is not dropped in silence. `TursoConfigSchema` is a plain
`z.object`, so a bare deletion would have STRIPPED `timeout` and parsed
successfully. The key stays declared as a tombstone instead: `tsc` refuses it on
anything typed `TursoConfig`, and a value that reaches the parse raises a
message naming `timeoutMs` rather than a generic unrecognised-key error.

```diff
- TursoConfigSchema.parse({ url: 'libsql://app.turso.io', timeout: 30000 })
+ TursoConfigSchema.parse({ url: 'libsql://app.turso.io', timeoutMs: 30000 })
```

`TursoDriverConfig` — this package's TypeScript constructor option, a separate
declaration — keeps its `timeout` spelling and is untouched here.

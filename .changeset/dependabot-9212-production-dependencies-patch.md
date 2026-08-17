---
"@objectstack/cli": patch
"@objectstack/driver-memory": patch
"@objectstack/driver-mongodb": patch
"@objectstack/driver-sql": patch
"@objectstack/driver-sqlite-wasm": patch
"@objectstack/driver-turso": patch
"@objectstack/metadata": patch
"@objectstack/plugin-auth": patch
"@objectstack/plugin-email": patch
"@objectstack/plugin-hono-server": patch
"@objectstack/plugin-pinyin-search": patch
"@objectstack/service-settings": patch
---

chore(deps): production-dependency patch bumps from the weekly Dependabot group (#9212)

Routine dependency-range refresh, no behavior change: `@oclif/core` 4.13.2→4.13.3,
`esbuild` 0.28.1→0.28.2 and `better-sqlite3` ^13.0.2→^13.0.3 (optional) on
`@objectstack/cli`; `mingo` 7.2.2→7.2.4 on `@objectstack/driver-memory`; `nanoid`
6.0.0→6.0.1 on `@objectstack/driver-mongodb`, `@objectstack/driver-sql`,
`@objectstack/driver-sqlite-wasm` and `@objectstack/driver-turso`, plus
`better-sqlite3` ^13.0.2→^13.0.3 (optional on `@objectstack/driver-sql`, peer on
`@objectstack/driver-turso`); `js-yaml` 5.2.2→5.2.3 on `@objectstack/metadata`;
`@noble/hashes` 2.2.0→2.3.0 and `jose` 6.2.5→6.2.8 on `@objectstack/plugin-auth`;
`nodemailer` 9.0.3→9.0.5 on `@objectstack/plugin-email`; `@hono/node-server`
2.0.12→2.1.1 and `hono` 4.12.34→4.13.2 on `@objectstack/plugin-hono-server`;
`pinyin-pro` 3.28.2→3.29.1 on `@objectstack/plugin-pinyin-search`; and
`@noble/ciphers` 2.2.0→2.3.0 on `@objectstack/service-settings`.

Every entry above changed a `dependencies`, `optionalDependencies` or
`peerDependencies` range in the published manifest — the only kind of change
that reaches a consumer's install. The same Dependabot group also bumped
`devDependencies` on `@objectstack/hono`, `@objectstack/client`,
`@objectstack/core`, `@objectstack/plugin-sharing` and `@objectstack/spec`
(none consumer-facing), and touched the private `apps/docs`,
`examples/app-todo` and workspace-root manifests (none published) — none of
those get an entry here.

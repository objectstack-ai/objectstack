---
"@objectstack/spec": minor
---

feat(spec)!: a duration-shaped `z.number()` key carries its unit in the key name — `hook.timeout` / `job.timeout` / `DriverOptions.timeout` → `timeoutMs`, `MetadataManagerConfig.cache.ttl` → `ttlSeconds`, `cache.databaseLoader.ttl` → `ttlMs`, tenant `idleTimeout` / `sessionTimeout` → `*Seconds`; new gate `check:duration-unit-keys` (#14478, #14519)

<!-- adr-0087: registered hook-timeout-to-timeout-ms, job-timeout-to-timeout-ms, metadata-manager-config-cache-ttl-unit-in-key, driver-options-timeout-to-timeout-ms, tenant-timeouts-unit-in-key -->

**BREAKING** rename of seven published authorable keys, shipped as `minor` under
the repo's launch-window convention for breaking changes; every rename is
registered under protocol major 18. Maintainer ruling 2026-09-02 on #14478
(director decision batch #14, verbatim 「14461 你不处理，其他同意」): **ruled B** —
a spec-source gate for duration-shaped number keys **with no grandfathered
baseline**, plus an ADR-0087 conversion of every offender the ruling named, in
one PR, on the standing rules 「不考虑存量」 and 「项目在创业阶段,用户也很少,短期不考虑渐进。」.
⛔ No alias, no transition window: each old spelling is a `retiredKey()`
tombstone whose rejection names the new key.

## The defect

`kernel/metadata-loader.zod.ts` carried two keys spelled `ttl` fourteen lines
apart: `cache.ttl` in **seconds** (default 3600) and `cache.databaseLoader.ttl`
in **milliseconds** (default 60000). Both descriptions named their unit; the
key names did not. An author who copied the outer number into the inner block
got a 3.6-second cache and no error anywhere — the number was valid, the type
was right, the cache was simply cold. `hook.timeout`, `job.timeout` and
`DriverOptions.timeout` had the same shape (milliseconds, said only in prose)
beside siblings that spell theirs (`backoffMs`, `intervalMs`, the body-level
`timeoutMs`). The two tenant keys were worse for the reader who matters most:
`.describe()` is what `content/docs/references/**` publishes and the JSDoc above
a key is not, so `idleTimeout` / `sessionTimeout` said "in seconds" in a source
comment and published a bare `300` / `3600` to the reference page (#14519).

## FROM → TO

| schema | before | after | value |
|:--|:--|:--|:--|
| `HookSchema` (`hooks[]`) | `timeout` | `timeoutMs` | unchanged (ms) |
| `JobSchema` (`jobs[]`) | `timeout` | `timeoutMs` | unchanged (ms) |
| `DriverOptionsSchema` | `timeout` | `timeoutMs` | unchanged (ms) |
| `MetadataManagerConfigSchema` | `cache.ttl` | `cache.ttlSeconds` | unchanged (s, default 3600) |
| `MetadataManagerConfigSchema` | `cache.databaseLoader.ttl` | `cache.databaseLoader.ttlMs` | unchanged (ms, default 60000) |
| `DatabaseLevelIsolationStrategySchema` | `connectionPool.idleTimeout` | `connectionPool.idleTimeoutSeconds` | unchanged (s, default 300) |
| `TenantSecurityPolicySchema` | `accessControl.sessionTimeout` | `accessControl.sessionTimeoutSeconds` | unchanged (s, default 3600) |

```ts
// before
defineHook({ name: 'audit_order', object: 'order', events: ['afterInsert'], handler: 'auditOrder', timeout: 5000 });
defineJob({ name: 'nightly_sweep', schedule: { type: 'cron', expression: '0 1 * * *' }, handler: 'sweep', timeout: 300000 });
new MetadataManager({ cache: { ttl: 3600, databaseLoader: { ttl: 60_000 } } });

// after — rename the key; the number is unchanged
defineHook({ name: 'audit_order', object: 'order', events: ['afterInsert'], handler: 'auditOrder', timeoutMs: 5000 });
defineJob({ name: 'nightly_sweep', schedule: { type: 'cron', expression: '0 1 * * *' }, handler: 'sweep', timeoutMs: 300000 });
new MetadataManager({ cache: { ttlSeconds: 3600, databaseLoader: { ttlMs: 60_000 } } });
```

**Migration.** Rename each key; no value changes. Authoring an old spelling
fails to compile (`tsc`: the input type is `never`) and fails to parse with a
prescription naming the new key. For `hooks[]` / `jobs[]` the rename is a
mechanical D2 conversion (`hook-timeout-to-timeout-ms`,
`job-timeout-to-timeout-ms`, retired from the load path): run
`os migrate meta --from 17` to list the edits for existing sources and apply
them by hand; stored `sys_metadata` rows are rehydrated through the same chain.
The other five keys have no stack seam (runtime config, a per-call options
argument, cloud tenancy config) and carry a semantic entry each. The
`JobScheduleOptions` contract key that carries `job.timeoutMs` to the scheduler
is renamed in lockstep (`timeout` → `timeoutMs`), as is `DatabaseLoaderOptions.cache.ttl` → `ttlMs` in `@objectstack/metadata`.

## The gate

`pnpm --filter @objectstack/spec check:duration-unit-keys`
(`packages/spec/scripts/check-duration-unit-keys.ts`, wired into `lint.yml`):
a property whose value is a `z.number()` / `z.int()` / `z.coerce.number()`
chain and whose `.describe()` names a time unit must carry that unit as a token
of its key name (`Ms` / `Seconds` / `Minutes` / `Hours` / `Days`, and the
knex-inherited `Millis`), and the token must agree with the prose — `ttlMs`
described "in seconds" is refused too. A `{ value, unit }` pair is recognised
by its sibling `unit` key; duration literals are strings and outside the
population. Calendar positions ("day of the month") and rates ("requests per
second") are skipped. There is no baseline and no `gen:`; a red is a rename
under an ADR-0087 conversion or a describe to fix.

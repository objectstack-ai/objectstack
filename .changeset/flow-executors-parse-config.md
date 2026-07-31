---
"@objectstack/service-automation": minor
"@objectstack/spec": minor
---

feat(automation,spec): flow executors `parse()` their config, and undeclared config keys reject at registration (#4277)

The #4045 reconciliation left every flat builtin with a Zod config contract that
nothing enforced, and #4059 left `registerFlow` warning about undeclared keys it
could not yet safely reject. #4277 installs both halves of the enforcement:

**1. Executors parse their config (execute time).** The 12 contract-carrying
builtins — `get_record` / `create_record` / `update_record` / `delete_record`,
`screen`, `map`, `notify`, `http`, `loop` / `parallel` / `try_catch` — now run
`node.config` through their Zod contract before executing
(`service-automation/builtin/parse-config.ts`). A type or missing-`required`
violation refuses the node as a **guard** (`errorClass: 'guard'`, not routable
via `fault` edges — config is metadata; re-running changes nothing), naming
every violated path. `{token}` templates stay legal: string-typed slots parse
the raw template, and `http` — whose executor reads the interpolated config —
parses POST-interpolation, where a whole-token template has already resolved to
its value's real type. Exemption: a legacy flat-graph `loop` (no `config.body`)
predates the ADR-0031 construct and is not parsed.

**2. Undeclared config keys are rejected at `registerFlow` (registration
time).** The #4059 warning is now an error: a config key the node type's
descriptor `configSchema` does not declare fails registration, with the exact
path, the declared key set, a did-you-mean, and — for keys with documented
history (`screen.visibleIf`, `create_record`/`update_record.fieldValues`) — a
per-key tombstone (the `UNKNOWN_KEY_GUIDANCE` pattern). Unchanged exemptions:
`assignment` is exempt wholesale (its top-level keys ARE the author's variable
names), schemaless types (`decision`/`script`/`wait`/`subflow`/
`connector_action`) declare nothing so nothing can be undeclared, and keyValue
maps stop the walk (their keys are author data). Every `registerFlow` call site
already try/catches per flow, so a bad stored flow is skipped loudly at boot,
never a crashed kernel.

**Contract fix folded in:** `LoopConfigSchema.collection` is now
`z.union([z.string().min(1), z.array(z.unknown())])` — the executor has always
accepted an inline array (shared resolve logic with `map.collection`, which
already declared the union), so the string-only declaration under-declared what
it reads.

**Migration.** If a flow stops registering: the error names the undeclared key
and its path — rename it to the declared key it meant (`visibleIf` →
`visibleWhen`, `fieldValues` → `fields`), or delete it (an undeclared key was
never read, so removing it changes no behavior). If an executor of yours
genuinely reads the key, declare it on the node type's descriptor
`configSchema`. If a node starts refusing at run time: the refusal names each
violated path against the contract — fix the value's type or supply the missing
required key (e.g. `get_record` `limit` must be a number; `screen`
`fields[].options` entries are `{ value, label }` objects; `notify` requires
`recipients` + `title`). Retry-policy defaults now come from the contract: a
`try_catch` `retry` block that omits `retryDelayMs` gets the documented 1000ms
base delay where the executor historically used 0.

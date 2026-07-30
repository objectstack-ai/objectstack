---
'@objectstack/spec': minor
'@objectstack/cli': patch
---

**`config.storage` is not a stack key, and an undeclared top-level key now says
so instead of vanishing (#4167).**

`os serve` read `config.storage` and forwarded it to `StorageServicePlugin`.
It could almost never arrive: `ObjectStackDefinitionSchema` does not declare
`storage`, and is not `.strict()`, so `defineStack` — which every documented
authoring path and every compiled artifact goes through — strips the key before
`serve` runs. The one combination that reached the branch (a bare-object config
on the config-boot path) then carried the `driver`/`root` spelling the plugin
does not read either, so it did nothing there too.

The result was one authoring key that worked on a single unreachable-in-practice
path and disappeared silently everywhere else. A host writing
`storage: { driver: 's3', … }` believed it had configured S3 and got local disk.

- **`serve` no longer reads it.** `resolveStorageCapabilityArg` takes only the
  env root; the production warning stops naming `config.storage` and names the
  two channels that work — `OS_STORAGE_*` and Setup → Settings, the latter being
  the one with proper credential handling.
- **`lintUnknownAuthoringKeys` now covers top-level stack keys**, not just object
  and field keys. `storage` gets a prescriptive entry naming both channels and
  why a stack definition is the wrong home for a credential — it would commit it
  to git and to any published artifact. An ordinary misspelling still gets the
  edit-distance suggestion (`datasource` → `datasources`), and the rule now runs
  even on a stack with no `objects` at all, which previously exited early.
- **`os migrate files-to-references` shares the resolver.** It built
  `{ driver: 'local', root }` — the same dead keys — so its adapter used
  `./storage` while the server writes under `.objectstack/data/uploads` since
  #4096. That command reconciles what records claim against what storage holds,
  so a disagreeing root reconciled against the wrong tree.

`lintUnknownAuthoringKeys(rawStack)` becomes
`lintUnknownAuthoringKeys(rawStack, stackSchema)`. The parameter is required
rather than optional so a caller that forgets it fails to compile instead of
silently losing the check — the exact failure this rule reports. It is injected
rather than imported because `stack.zod.ts` imports this module, and importing
back would close a cycle.

Verified end to end: authoring `storage:` through `defineStack` warns at load,
and `os compile` reports it for configs that skip `defineStack`.

Nothing is being taken away that worked. `storage` was never in the schema, is
not documented anywhere, and has no consumer in `objectstack-ai/cloud` (checked).
Whether the platform should eventually grow a real in-stack storage declaration
is a separate question — if so it should follow `datasources`, which solves
credentials by referencing `sys_secret` rather than inlining them, and that
deserves an ADR rather than a resurrected undeclared key.

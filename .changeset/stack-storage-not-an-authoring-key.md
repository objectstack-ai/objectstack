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
- **The undeclared-key lint now covers the stack's own top-level keys.** New
  `lintUnknownStackKeys(rawStack, stackSchema)`, wired into `defineStack`,
  `os validate` and `os compile` beside the existing walker. `storage` gets a
  prescriptive entry naming both channels and why a stack definition is the
  wrong home for a credential — it would commit it to git and to any published
  artifact. An ordinary misspelling still gets the edit-distance suggestion
  (`datasource` → `datasources`).
- **`os migrate files-to-references` shares the resolver.** It built
  `{ driver: 'local', root }` — the same dead keys — so its adapter used
  `./storage` while the server writes under `.objectstack/data/uploads` since
  #4096. That command reconciles what records claim against what storage holds,
  so a disagreeing root reconciled against the wrong tree.

**`onEnable` is exempt, and the exemption has one owner.** `onEnable` is a
function, so `ObjectStackDefinitionSchema` cannot declare it and
`dist/objectstack.json` cannot carry it — but it is not lost: `AppPlugin` calls
it off the authored bundle, and the artifact-boot path grafts it back (#4095).
"Not declared" and "dropped at load" are different claims, and this is the
surface where they come apart. New `STACK_RUNTIME_MEMBERS` in `@objectstack/spec`
names the members the runtime honours off the bundle; the lint treats them as
declared, and the CLI's `GRAFTABLE_RUNTIME_MEMBERS` is now **derived** from it
rather than restating it, so the list that decides what gets grafted and the
list that decides what the lint stays quiet about cannot drift. `onDisable` is
deliberately not on it — nothing calls it, so a value written there really does
go nowhere and the lint should say so.

Additive: `lintUnknownAuthoringKeys` keeps its signature. The new pass is a
separate export rather than a fold into that walker for two reasons. The walker
iterates metadata COLLECTIONS, so a stack whose only mistake is at the envelope
level — no objects, no pages, nothing to iterate — walks clean; and the stack
schema has to be INJECTED, because `stack.zod.ts` imports the lint module and
importing back would close a cycle. A separate export keeps that requirement
visible: a call site either asks for the coverage or does not, and its absence
shows up in a diff. An optional parameter would be the same silent-loss shape
this rule family exists to report. It follows the walker's posture rule — only a
schema that STRIPS unknown keys is linted, so if the stack schema ever graduates
to `.strict()` the parse takes over and this goes quiet.

Verified end to end: authoring `storage:` through `defineStack` warns at load,
and `os compile` reports it for configs that skip `defineStack`.

Nothing is being taken away that worked. `storage` was never in the schema, is
not documented anywhere, and has no consumer in `objectstack-ai/cloud` (checked).
Whether the platform should eventually grow a real in-stack storage declaration
is a separate question — if so it should follow `datasources`, which solves
credentials by referencing `sys_secret` rather than inlining them, and that
deserves an ADR rather than a resurrected undeclared key.

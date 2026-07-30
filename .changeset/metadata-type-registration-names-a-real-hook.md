---
'@objectstack/spec': patch
---

**The metadata-type registry told plugins to use a hook that does not exist (#4212).**

`registerMetadataTypeSchema` and `registerMetadataTypeActions` both documented
themselves as things a plugin calls "from its `onInstall` hook", and named
`/api/v1/meta/types/:type` as the endpoint that would then serve the result.
Neither is real:

- The kernel's plugin contract is **`init` / `start` / `destroy`**
  (`packages/core/src/types.ts`). The `onInstall` / `onEnable` / `onDisable` /
  `onUninstall` / `onUpgrade` family on `PluginLifecycleSchema` has no
  invocation site anywhere in the runtime — `kernel.use()` validates and
  stores, `bootstrap()` calls `init` then `start`. A plugin that followed the
  documented advice registered nothing, and got no error saying so.
- **`/api/v1/meta/types/:type` is not a registered route.** What exists is
  `GET /api/v1/meta` and the server-only `GET /meta/types`, both served from
  `getMetaTypes()`.

Both TSDoc blocks and `content/docs/plugins/adding-a-metadata-type.mdx` now
name the hook that runs and the endpoint that exists. The example is written as
a real `Plugin` with an `init(ctx)`, matching `DatasourceAdminServicePlugin` —
the one production caller of `registerMetadataTypeActions`, which has always
used `init` rather than the documented `onInstall`.

Two facts worth knowing that the old text obscured, now stated:

- `getMetaTypes()` reads these registries **at request time**, not from a boot
  snapshot, so a type registered during `init` is served from the first call.
- Registering a schema does **not** by itself put a type in the listing.
  `getMetaTypes()` enumerates types from the engine registry unioned with the
  metadata service and then decorates each with its schema, so a type present
  only in the schema registry is never reached. Declare the type via
  `additionalTypes` as well.

Documentation only — no behaviour change. The broader question of whether the
five declared-but-uninvoked lifecycle hooks should be implemented or retired
(ADR-0049 enforce-or-remove) is tracked in #4212; this change stops the
registry's own docs from sending authors at the dead one in the meantime.

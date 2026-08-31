---
"@objectstack/core": patch
---

docs(core): correct `Plugin.type`'s TSDoc enumeration — it omitted `objectql` (#13762)

`Plugin.type` is typed `string` in `@objectstack/core`, so its TSDoc is the only
enumeration a plugin author reading the interface ever sees; nothing type-checks
them against it. That comment listed seven values while the declared set is
eight: `PluginSchema.type` in `@objectstack/spec` is
`z.enum(['standard', ...CORE_PLUGIN_TYPES])`, and `CORE_PLUGIN_TYPES` carries
`objectql` — the type `packages/objectql/src/plugin.ts` declares on the engine
plugin essentially every runtime loads first.

The comment now lists all eight and names `CORE_PLUGIN_TYPES` as the
authoritative set. The same omission in the hand-written
`content/docs/plugins/anatomy.mdx` transcription of this interface is corrected
in the same change.

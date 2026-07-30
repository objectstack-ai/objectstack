---
"@objectstack/spec": major
---

refactor(spec)!: remove the Dev Mode Plugin Protocol family — a declared dev protocol nothing implemented, whose stub vocabulary described the design ADR-0115 retired (#4149)

`DevPluginConfigSchema`, `DevServiceOverrideSchema`, `DevFixtureConfigSchema`,
`DevToolsConfigSchema` and `DevPluginPreset` (`@objectstack/spec/kernel`,
dev-plugin.zod) are removed outright. The family declared a full dev-mode
configuration protocol — presets (minimal/standard/full), fixture loading, a
dev-tools dashboard on port 4400, per-service `mock`/`memory`/`stub`/
`passthrough` strategies, simulated latency — and none of it ever existed:

- **Zero consumers.** `@objectstack/plugin-dev` reads its own
  `DevPluginOptions` interface and never imported these schemas; no other
  package did either. The only references were the generated artifacts and the
  family's own shape test.
- **No load path parsed it.** `stack.devPlugins` takes
  `ManifestSchema | string` (plugin manifests/names), not this config — so no
  authored source can carry these keys, which is why there is deliberately NO
  `retiredKey()` tombstone and NO ADR-0087 conversion: a prescription nobody
  can receive is noise, and there is no source for `os migrate meta` to
  rewrite (the `plugin-runtime.zod.ts` DynamicLoadingConfig precedent, #3950).
- **Its vocabulary contradicted the platform.** `strategy: 'stub'` taught the
  fill-the-slot-with-a-fake design that ADR-0115 retired; keeping the schema
  meant the spec recommending what the runtime forbids.

FROM → TO: if you imported any of the five types from
`@objectstack/spec/kernel`, delete the import — there is nothing to migrate to,
because nothing ever consumed the values. To configure local development, use
`DevPluginOptions` from `@objectstack/plugin-dev` (port, seedAdminUser,
authSecret, per-part `services` toggles, extraPlugins, stack).

The retirement kit: baselines dropped deliberately (`json-schema.manifest.json`
minus the five `kernel/Dev*` entries; `authorable-surface.json` minus the 22
`kernel/Dev*` lines — nothing can author them, so no `[RETIRED]` markers);
`api-surface.json` regenerated (the five exports leave the public surface);
generated reference doc removed by `gen:docs`; v17 release notes' dead-clusters
table extended. No liveness-ledger entries existed (the ledger tracks metadata
types; this was never one).

No runtime behaviour changes — that impossibility is the reason for the removal.

---
"@objectstack/spec": minor
---

feat(spec): retire the inert `additionalTypes` key from `MetadataPluginConfig` (#8586, ADR-0049)

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

`MetadataPluginConfig.additionalTypes` was declared, authorable, and documented
on four docs pages as THE way a plugin registers a custom metadata type — and
read by **nothing**. The only production writer of the manager's type registry
is `setTypeRegistry(DEFAULT_METADATA_TYPE_REGISTRY)`, called exactly once, and
it replaces the array outright: measured on the real `MetadataManager`,
declared count == live count (27 == 27). An author who followed the published
instructions wrote the key, got no error, and nothing happened — the #4212
`onInstall` silence trap one level down (maintainer-ruled REMOVE, 2026-08-14).

**What is refused:** an authored `additionalTypes` on `MetadataPluginConfig`
(inline or via the manifest's `config` embed). The key is a `retiredKey()`
tombstone — the schema is not `.strict()`, so a plain deletion would have
silently stripped it — refused at `tsc` (typed `never`) and at the parse
(`invalid_type` at path `additionalTypes`, message carrying the prescription).

**What stays accepted:** every `MetadataPluginConfig` without the key,
byte-identically. Runtime behaviour is unchanged: nothing ever read the key,
so removing it removes no behaviour.

The retirement kit:

- tombstone at the schema (`packages/spec/src/kernel/metadata-plugin.zod.ts`)
- ADR-0087 registration: retired-key entry
  `kernel/MetadataPluginConfig:additionalTypes` + D3 semantic entry
  `metadata-plugin-additional-types-retired`, both under protocol 18 (no D2
  conversion — a plugin config is not a stack collection member, the
  `kernel/Manifest:loading` precedent)
- pin tests (`additional-types-retirement.test.ts`)
- docs corrected: `content/docs/plugins/adding-a-metadata-type.mdx` (four
  sites) now describes how a kind actually enters the live set — as a side
  effect of registering an item of that kind; the generated reference page
  follows the schema
- the two source comments that asserted the phantom growth path
  (`metadata-manager.ts`, `metadata-protocol/src/protocol.ts`) and the
  `registerMetadataTypeSchema` doc note corrected

## FROM → TO

```ts
// before — parsed green; the entries were merged into nothing
const config: MetadataPluginConfig = {
  storage: {},
  additionalTypes: [{ type: 'chart', label: 'Chart', filePatterns: ['**/*.chart.ts'], domain: 'ui' }],
};

// after — delete the key; register items of the kind instead, and bind its schema
const config: MetadataPluginConfig = { storage: {} };
// in the plugin: registerMetadataTypeSchema('chart', ChartSchema) from init(ctx);
// the kind enters the live set when an item of it is registered.
```

<!-- adr-0087: registered metadata-plugin-additional-types-retired -->

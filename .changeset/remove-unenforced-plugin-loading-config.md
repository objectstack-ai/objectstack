---
"@objectstack/spec": major
---

refactor(spec)!: remove the plugin sandboxing / integrity / approval config that never existed (#3896 follow-up)

`DynamicLoadingConfigSchema`, `PluginDiscoveryConfigSchema` and
`PluginDiscoverySourceSchema` declared a plugin security control set —
`defaultSandbox`, `requireIntegrity`, `allowedSources`, and discovery's
`requireApproval` ("require admin approval before loading discovered plugins").

**None of it was ever wired to anything.** The three schemas were an island: not
composed into any parent schema, not read by any runtime, referenced only by
their own round-trip tests. They were nonetheless published into `json-schema/`
and the authorable key surface, where an author — very often an AI (ADR-0033) —
would read them as capabilities this platform has. A reader of the spec could
reasonably conclude ObjectStack sandboxes dynamically loaded plugins. It does
not.

That is the ADR-0049 false-compliance shape, and the precedent for a
SAFETY-shaped instance is to remove rather than mark dead:
`tool.requiresConfirmation` was pruned in #3715 because it was "unenforced on
every path, so it was false compliance, not merely dead". This is the same case,
one layer up.

Found while building the empty-state gate (#3945): `allowedSources` documented
`[]` as admitting every source, and checking who enforced that turned up nobody.

**No `retiredKey()` tombstones, deliberately.** A tombstone earns its keep by
making a removal audible at a parse the author actually reaches — and nothing
parses these schemas, so the prescription could never be delivered. The
silent-strip that the key-vanish guard exists to prevent was already these keys'
permanent condition: writing one has always been a no-op, because no parent
schema ever accepted them. The guard's baseline entries in
`json-schema.manifest.json` and `authorable-surface.json` are therefore dropped
in this PR as the deliberate removal both files document as the legitimate path,
rather than tombstoning 15 keys nobody could have successfully authored.

**Breaking, in the narrow sense.** `packages/spec/src/kernel/index.ts`
re-exports this module with `export *`, and `./kernel` is a published subpath, so
`DynamicLoadingConfig`, `PluginDiscoveryConfig`, `PluginDiscoverySource` and
their schemas were importable as types. Nothing in this repo imported them.
Marked `major` because removing a public export is breaking regardless of use;
in practice it folds into the unreleased 17.0.0.

The rest of `plugin-runtime.zod.ts` is untouched — including
`ActivationEventSchema`, the one export in the file with real consumers. Note
that the remainder (`DynamicLoadRequest`, `DynamicUnloadRequest`,
`DynamicPluginResult`, `PluginSource`, `DynamicPluginOperation`) also has no
runtime consumer today; it is left in place because those are operation
contracts, not security promises, and the enforce-or-remove call on them is a
design decision rather than a correction.

**Rebuilding this surface is a design job, not a schema job**: write the runtime
first, then declare only what it enforces.

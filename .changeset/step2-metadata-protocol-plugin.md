---
"@objectstack/metadata-protocol": minor
"@objectstack/objectql": minor
---

feat(metadata-protocol,objectql): MetadataProtocolPlugin + `registerProtocol` opt-out — ADR-0076 Step 2 PR-A (#2462)

`createMetadataProtocolPlugin()` now owns what `ObjectQLPlugin` historically
assembled inline: the `ObjectStackProtocolImplementation` construction +
`protocol` registration, the metadata-storage platform objects, and the D12
`degraded` analytics fallback (pattern: plugin-security — named plugin,
`dependencies` on the engine, `ctx.getService('objectql')`). `ObjectQLPlugin`
grows `registerProtocol?: boolean` (default `true`, fully backward
compatible): pass `false` when mounting the new plugin. Protocol CONSUMERS
stay on the engine plugin either way — DB hydration and the authored
hook/action rebind resolve `protocol` lazily (the rebind arms from `start()`
in delegated mode) and degrade gracefully. Mixing both assemblies fails fast
with the fix in the message. This is the additive first leg of the
cross-repo sequence; cloud's 3 boot sites flip in PR-B, the built-in
assembly + re-exports retire in PR-C.

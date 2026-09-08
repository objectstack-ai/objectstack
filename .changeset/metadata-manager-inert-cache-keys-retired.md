---
"@objectstack/spec": minor
"@objectstack/metadata": patch
---

feat(spec)!: retire the three inert outer keys of `MetadataManagerConfig.cache` — `enabled`, `ttlSeconds` (formerly `ttl`) and `maxSize` — read by nothing; `cache.databaseLoader` is the only live half (#15624, ADR-0049)

<!-- adr-0087: registered metadata-manager-config-inert-cache-keys-retired -->

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).
ADR-0049 enforce-or-remove decides it: a declared-but-unenforced key with zero
measured readers comes off, and the published reference page stops teaching it.

`MetadataManagerConfig.cache` declared three outer knobs — `enabled` (default
`true`), `ttlSeconds` (default 3600; spelled `ttl` until #14478) and `maxSize`
("Max cache size in bytes") — beside the nested `databaseLoader` block, and
**nothing read the outer three**. The only runtime consumer of the block is
`MetadataManager` (`packages/metadata`), which hands `cache.databaseLoader` and
nothing else to `new DatabaseLoader({ cache })`; a reader census over
`packages/**` (tests and changelogs excluded) found no runtime reader of any
outer key, while the same grep shape found the nested `cache?.databaseLoader`
read twice — the control that makes the zero a measurement. An author writing
`cache: { enabled: false }` or `cache: { ttlSeconds: 60 }` got a clean parse
and a cache that behaved exactly as before, with no error and no warning, and
the published reference page (`references/kernel/metadata-loader`) documented
all three as if they configured something.

**What is refused:** authoring `cache.enabled`, `cache.ttlSeconds`, `cache.ttl`
or `cache.maxSize` on `MetadataManagerConfig`, with any value — directly, through
`MetadataManagerOptions`, or through `MetadataPluginConfig.storage`. The nested
object is not `.strict()`, so each key is a `retiredKey()` tombstone rather than
a bare deletion (a deletion would have stripped it in silence — the same no-op
one layer down): authoring it is a `tsc` error (`never`) and a parse error
carrying the prescription, which names the live nested knob.

**What stays, byte-identical:** the DatabaseLoader read-through cache under
`cache.databaseLoader` — `enabled` (default `true`), `maxSize` (an entry count,
default 500) and `ttlMs` (milliseconds, default 60000) — and every runtime
path. Parsed configs no longer carry the two former defaults (`enabled: true`,
`ttlSeconds: 3600`) that were materialized and never consulted.

**The #14478 rename is folded in.** `cache.ttl` → `cache.ttlSeconds` was
registered under this same unreleased major and never reached a published
release, so it is absorbed by the removal: `cache.ttl`'s tombstone now
prescribes deletion (naming `cache.databaseLoader.ttlMs`) instead of a rename to
a key that is itself retired — an author upgrading from a published 17.x sees
one hop. The nested `cache.databaseLoader.ttl` → `ttlMs` half of that rename is
unchanged.

## FROM → TO

```ts
// before — parsed green; no runtime ever read the three outer numbers
new MetadataManager({
  datasource: 'default',
  cache: { enabled: true, ttlSeconds: 3600, maxSize: 10_485_760, databaseLoader: { ttlMs: 60_000 } },
});

// after — delete the outer keys; the nested block is the cache that runs
new MetadataManager({
  datasource: 'default',
  cache: { databaseLoader: { enabled: true, maxSize: 500, ttlMs: 60_000 } },
});
```

**Migration.** Delete `cache.enabled`, `cache.ttlSeconds` / `cache.ttl` and
`cache.maxSize`; nothing replaces them, because nothing ever consumed them. If
you meant to switch the cache off, cap it or set its TTL, write
`cache.databaseLoader.enabled` / `.maxSize` (entries) / `.ttlMs` (milliseconds)
— those are honoured. No `os migrate meta` conversion runs on this surface: a
`MetadataManager` config is not a stack collection member and never a stored
row, so the chain has no seam for it; the D3 semantic entry
`metadata-manager-config-inert-cache-keys-retired` carries the prescription
into `spec-changes.json`, the upgrade guide and the `spec_changes` MCP tool.

The retirement kit: `retiredKey()` tombstones on all three (and the absorbed
`ttl`), `RETIRED_KEYS_BY_MAJOR[18]` entries for each, the D3 semantic entry
above (the #14478 entry's outer half is re-worded from a rename to a deletion),
negative pins asserting each prescription and a positive pin asserting the
parse output no longer materializes the retired defaults, the published
reference pages regenerated, and the hand-written docs page and this package's
README (`@objectstack/metadata` ships `README.md`, hence its `patch`) no longer
authoring `cache.enabled`.

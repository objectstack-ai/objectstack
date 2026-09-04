---
"@objectstack/metadata": minor
---

feat(metadata)!: `DatabaseLoaderOptions.cache.ttl` → `cache.ttlMs` — the read-through cache TTL carries its unit in the key name (#14478)

<!-- adr-0087: not-required (already-registered metadata-manager-config-cache-ttl-unit-in-key) The authorable key this option mirrors — `MetadataManagerConfig.cache.databaseLoader.ttl` → `ttlMs` — is registered by the `@objectstack/spec` changeset of the same change; this package's exported `DatabaseLoaderCacheOptions` interface follows that key one-to-one and has no separate metadata surface to register. -->

**BREAKING** rename on the exported `DatabaseLoaderOptions.cache` shape
(`DatabaseLoaderCacheOptions.ttl` → `ttlMs`), shipped as `minor` under the
launch-window convention. `MetadataManager` hands `config.cache.databaseLoader`
straight to `new DatabaseLoader({ cache })`, so this option is the spec key
`cache.databaseLoader.ttlMs` one layer down and renames with it: a loader
configured with `ttlMs: 60_000` expires entries after 60 seconds exactly as
`ttl: 60_000` did. The README example and the kernel metadata-service docs page
spell the new key.

```ts
// before
new DatabaseLoader({ driver, cache: { enabled: true, maxSize: 500, ttl: 60_000 } });
// after
new DatabaseLoader({ driver, cache: { enabled: true, maxSize: 500, ttlMs: 60_000 } });
```

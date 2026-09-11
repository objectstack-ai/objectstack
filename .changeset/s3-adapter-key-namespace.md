---
"@objectstack/service-storage": minor
---

**Clause-②: yes** — a new REQUIRED member on two published option types (`S3StorageAdapterOptions.keyPrefix`, and the `s3` member of `StorageServicePluginOptions`), so the accept set a consumer writes against narrows. Contract-review tier.

**BREAKING** — `S3StorageAdapterOptions` and `StorageServicePluginOptions.s3` now require `keyPrefix: string | null`. Shipped as `minor` under the repo's launch-window convention, in which `major` is refused by `check-changeset-no-major` and breaking-ness is carried by this banner plus the ADR-0087 disposition rather than by the level.

The **S3 adapter can now be confined to a key namespace**, and the confinement is structural rather than conventional: a caller holding the adapter has no door through which it can reach an unprefixed key.

`keyPrefix` is applied on `upload` / `download` / `delete` / `exists` / `getInfo`, on both presigned doors, on every multipart door, and into `list()`'s `Prefix` — and it is stripped off every key and every `list()` cursor coming back. Callers therefore supply and receive unprefixed keys at every door, in both directions, and `list('')` enumerates this adapter's namespace and nothing else. Keys are concatenated, never path-joined, so a caller key such as `../elsewhere` stays a literal key inside the namespace instead of escaping it.

**Why it is required rather than optional.** A shared bucket with no namespace has one thing keeping one deployment out of another's objects: that every `sys_file` metadata check above the adapter was written correctly. On a route that takes an identifier out of a request, one missed check is a cross-deployment read the object store cannot refuse, because what it sees is a well-formed key. An optional prefix reproduces exactly that gap the first time a host forgets to set it, silently — so the choice is made at the call site or the code does not compile. `null` is the written, greppable way to ask for bucket-root keys, and it produces byte-identical keys to those written before this option existed.

For the same reason an empty or whitespace-only string is **refused at construction** rather than treated as "no prefix": that is what an unset environment variable looks like after interpolation. A leading `/` and any `..` segment are refused too, and a missing trailing `/` is appended — the last of those is load-bearing, not tidiness: S3 `Prefix` is a raw string match, so `tenant_1` without the delimiter also matches `tenant_10/...`, and one namespace would enumerate its neighbour through the isolation mechanism itself.

Two further seams move with it:

- `StorageServicePlugin` carries the **host's** namespace onto every adapter a `storage` settings re-read rebuilds, and deliberately reads no prefix out of the settings values. A boundary an administrator inside the deployment can set or clear is a preference, not a boundary; without this, one settings save returned a hosted deployment to a shared, unprefixed key space. A host that declared no `s3` constructor options expressed no namespace, and settings-configured S3 stays bucket-root as before.
- `resolveStorageTarget` puts the namespace in the target's **`location`**, not merely its fingerprint: two prefixes in one bucket are two disjoint object sets, so moving the prefix strands what the old one held exactly as moving the bucket does, and the swap must print the migration warning. `env_7` and `env_7/` normalise to one target, so the same namespace spelled two ways is not read as a move.

`LocalStorageAdapterOptions` is deliberately unchanged: `resolvePath()` already refuses any `..` and joins every key under `rootDir`, so the local adapter's containment boundary exists and a second mechanism would be two ways to say one thing.

**Migrating:** every `new S3StorageAdapter({ ... })` and every `new StorageServicePlugin({ adapter: 's3', s3: { ... } })` gains one member. Single-tenant deployments write `keyPrefix: null` and their keys do not move. Deployments sharing a bucket write the namespace they want and should treat the change as a store move — existing objects are not migrated into the new namespace.

<!-- adr-0087: runtime-interface-only packages/services/service-storage/src/s3-storage-adapter.ts#S3StorageAdapterOptions a storage adapter is CODE, never stack metadata: nothing ever runs an `S3StorageAdapterOptions` through a `.parse()`, there is no stored `sys_metadata` shape for `objectstack migrate meta` to rewrite, and no schema tombstone would reach anyone. The affected party is a TypeScript host constructing the adapter and the delivery channel is tsc, which reports at their own call site. Same disposition, and the same reason, as this adapter's `list(prefix)` retirement. -->

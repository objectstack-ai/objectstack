---
"@objectstack/metadata": patch
---

fix(metadata): `capabilities.write` now also binds `save()` — a writable datasource loader must implement both halves of the write (#5654)

#5276 (shipped in v17.0.0-rc) made `capabilities.write` binding on `delete()`:
a loader declaring `protocol: 'datasource:'` with `capabilities.write: true`
and no `delete()` is refused at registration, because `unregister()` used to
skip it silently and announce the deletion anyway. The gate stopped there, so
**one declaration was binding at one end of an item's life and decorative at
the other**.

`MetadataManager.register()` had the identical hole one direction over. Its
persistence loop read `loader.save &&` first, so a `datasource:` loader
declaring `capabilities.write: true` **without** a `save()` method was
**silently skipped** — no warn, no error. `register()` then wrote the in-memory
registry, invalidated the list cache, announced `created`/`updated` and notified
watchers, so the caller (Studio/Setup, REST PUT, the CLI, a package publish) was
told the write succeeded. The item read back correctly for the life of the
process and was **gone at the next restart**, with nothing to retry it — a
durability degradation that leaves the system looking entirely healthy.

`registerLoader()`'s gate (renamed `assertWritableLoaderContract`) now requires
**both** `save()` and `delete()` for that combination, and rejects with one
message naming which method is missing, the consequence, and both repairs.
`registerLoader()` is the sole writer of the loader map — the constructor's
`config.loaders` funnel through it — so the combination can no longer reach the
runtime and lose a write there. The `save` short-circuit inside `register()`
survives as defensive code whose unreachability is now guaranteed by
construction, exactly like `unregister()`'s.

**Does this affect you?** Only if you register a custom metadata loader that
declares `protocol: 'datasource:'` with `capabilities.write: true`. If it does
and has no `save()`, registration now throws where it previously succeeded and
quietly discarded your writes. Two ways to fix it, both stated in the error:

1. implement
   `async save(type: string, name: string, data: any, options?: MetadataSaveOptions): Promise<MetadataSaveResult>`
   on the loader, persisting the item into its store (`DatabaseLoader` in this
   package is the reference implementation); or
2. if the loader is genuinely read-only, declare `capabilities.write: false` — a
   read-only `datasource:` loader registers without complaint and is never
   written to in the first place.

Loaders on the other protocols (`file:`, `memory:`, `http:`, `s3:`) are
unaffected: `MetadataManager` never persists to them at runtime, so they may
declare `capabilities.write` without a `save()`/`delete()` exactly as before.
The one `datasource:` loader shipped in this package, `DatabaseLoader`, has
always implemented both and is unchanged.

---
"@objectstack/metadata": patch
---

fix(metadata): `capabilities.write` now means BOTH directions — a writable datasource loader must implement `delete()` (#5276)

`MetadataLoader` declared `save?` and no `delete`, so `capabilities.write` meant
two different things at the two ends of an item's life: to `register()` it meant
"persist into me", and to `unregister()` it guaranteed nothing at all.
`unregister()` duck-typed `delete` at the call site and, when a loader had none,
**silently skipped it** — then dropped the registry entry, invalidated the list
cache and announced a `deleted` event anyway. The caller (Studio/Setup, REST
DELETE, the CLI, a package teardown) was told the delete succeeded while the row
stayed in the loader's store, was read straight back out by the next
`list()`/`get()`, and survived every restart with nothing to retry it.

Two changes, both making the declaration binding instead of decorative:

- **`MetadataLoader` now declares `delete?(type: string, name: string): Promise<void>`.**
  The capability is stated on the contract, next to `save?`, instead of being
  guessed at by each caller. A loader implemented against the interface can now
  see that the method exists.
- **`MetadataManager.registerLoader()` rejects the combination that cannot
  honour it.** A loader declaring `protocol: 'datasource:'` **and**
  `capabilities.write: true` **without** a `delete()` method is refused at
  registration with an error naming the loader, the consequence, and both
  repairs. `registerLoader()` is the sole writer of the loader map — the
  constructor's `config.loaders` funnel through it — so the combination can no
  longer reach the runtime and lose a deletion there.

**Does this affect you?** Only if you register a custom metadata loader that
declares `protocol: 'datasource:'` with `capabilities.write: true`. If it does
and has no `delete()`, registration now throws where it previously succeeded and
quietly discarded your deletions. Two ways to fix it, both stated in the error:

1. implement `async delete(type: string, name: string): Promise<void>` on the
   loader, removing the item from its store (`DatabaseLoader` in this package is
   the reference implementation); or
2. if the loader is genuinely read-only, declare `capabilities.write: false` — a
   read-only `datasource:` loader registers without complaint and is never
   written to in the first place.

Loaders on the other protocols (`file:`, `memory:`, `http:`, `s3:`) are
unaffected in either direction: `MetadataManager` never persists to them at
runtime, so it has no deletion of its own to take back, and they may declare
`capabilities.write` without a `delete()` exactly as before. The one
`datasource:` loader shipped in this package, `DatabaseLoader`, has always
implemented `delete()` and is unchanged.

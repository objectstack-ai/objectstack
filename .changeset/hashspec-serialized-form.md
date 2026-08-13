---
"@objectstack/metadata-core": minor
"@objectstack/metadata-fs": patch
---

fix(metadata-core,metadata-fs): hash the serialized form, so `put().version` identifies the bytes actually stored (#7856)

`hashSpec` canonicalised a `Date` to `{}`, because `canonicalize` walked a
value's own enumerable keys and a `Date` has none. `JSON.stringify` — what every
repository actually writes — turns the same `Date` into an ISO string. So the
hash of the in-memory spec and the hash of the bytes on disk were **different
hashes for the same item**, and the version handed back to a caller did not
identify what had been stored.

Measured on `main`, one spec carrying one `Date`:

```
canonicalize(in-memory) : {"createdAt":{},"label":"Home"}
JSON.stringify (bytes)  : {"label":"Home","createdAt":"2024-01-01T00:00:00.000Z"}
```

`canonicalize` now honours `toJSON` exactly as `JSON.stringify` does —
consulted once per position, its result serialised as-is and never
re-consulted — which makes a new guarantee true by construction:

```
canonicalize(x) === canonicalize(JSON.parse(JSON.stringify(x)))
```

**Both repository implementations were wrong, in different places**, which is
why the fix is one function rather than two patches. `FileSystemRepository`
broke `put().version === get().hash`: it hashed the spec it was handed, wrote
`JSON.stringify` of it, and re-hashed the parse on the way back out.
`InMemoryRepository` broke the repository contract's invariant 4
(`item.hash === hashSpec(item.body)`): it stores `body` already serialised
(`clonePlain`) while hashing the in-memory spec, so the item it returns
disagreed with its own hash. `SysMetadataRepository` inherits the fix through
the same function.

Downstream, an incoherent version meant a repository could report an
`{op:'update', actor:'fs'}` for a file nothing outside the process had touched:
the head index held a hash the disk could never reproduce, so re-reading one's
own write looked like somebody else's edit. That surfaces without any watcher —
a restart rebuilds the index from disk and the version the caller was handed no
longer matches it.

**Ordinary specs hash exactly as before, and this is not a migration.** The new
path diverges only at a position carrying a callable `toJSON`; a graph without
one is byte-identical through `canonicalize`. Verified against this repository's
entire checked-in JSON corpus — 1973 files hashed under both the old and the new
implementation, **0 hashes changed** — and the `hashSpec({})` regression guard
in `metadata-core` is unmoved. Stored versions for ordinary specs keep their
meaning. Versions for `toJSON`-carrying specs do change, and those are exactly
the versions that never identified their stored bytes in the first place.

Also supported as a consequence: a class instance with a `toJSON` now hashes as
whatever it serialises to, rather than as its private fields. One without a
`toJSON` still hashes as its own enumerable keys — which is what
`JSON.stringify` writes for it.

The pin is table-driven and lives in the shared repository contract suite, so
every `MetadataRepository` implementation is held to it: `Date` at a key, `Date`
under an array index, a class whose `toJSON` yields a string, an object literal
carrying its own `toJSON`, a nested case, and a plain-JSON control row that
proves the fix did not simply change every hash.

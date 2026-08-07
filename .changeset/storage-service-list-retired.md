---
"@objectstack/spec": major
---

refactor(spec)!: retire `IStorageService.list(prefix)` — one contract method, two adapter dialects, both silently incomplete, and no caller (#5540, ADR-0049 enforce-or-remove)

`list?(prefix)` was an optional method on the storage contract, documented as

> List files in a directory/prefix

and the two shipped adapters answered the same call with two different meanings.
Neither told you.

**The local adapter listed one level and counted directories as files.**
`LocalStorageAdapter.list` was a plain `readdir` over the prefix directory, so a
nested key `a/b/c` was invisible under `list('a')` — you got `a/b` — and every
subdirectory that `stat` succeeded on was pushed into the result as if it were a
file, producing a `StorageFileInfo` whose `size` is a directory inode and which
`download()` cannot fetch.

**The S3 adapter recursed and stopped at 1000.** `S3StorageAdapter.list` issued
one `ListObjectsV2` with the prefix — which matches the whole key, so it is
recursive, not one level — and read neither `IsTruncated` nor
`ContinuationToken`. Past 1000 objects, the "all files under this prefix" a
caller received was the first page, with nothing to distinguish it from a
complete answer.

So the same call was one-level-plus-junk on one deployment and
recursive-but-truncated on the other, and the first feature that genuinely
needed to enumerate a prefix — backup, orphan sweep, migration audit — would
have got two different wrong answers and no error on either.

**Nothing called it.** The only call site in the repository was the
`SwappableStorageService` pass-through, which rejects anyway when the active
adapter has no `list`. REST, the CLI and the storage routes never called it.
#5172 came closest: it planned to reclaim email-attachment content by listing
`EMAIL_ATTACHMENT_KEY_PREFIX`, discovered the local adapter could not see one
level down, and switched to queue-driven deferred work — the divergence cost a
design, and the method still had no consumer afterwards.

**Migration.**

| Wrote | Write instead |
| --- | --- |
| `await storage.list('attachments/task/')` | query the records you wrote — `sys_file` / file-reference rows carry the storage key and page deterministically through ObjectQL |
| `list?(prefix) { … }` on your own adapter | delete the method (see below) |
| `if (typeof storage.list === 'function')` capability probe | delete the branch; the contract has no `list` to probe for |

Querying your own records is not a workaround for the missing method — it is the
only form that was ever correct across both backends and past 1000 objects. The
bucket was never the system of record for "which files exist"; the rows are.

**Adapter authors: nothing breaks on you.** An implementation left in place still
compiles — an extra method is not an error on a class — it is simply unreachable
through the contract, so deleting it is cleanup you can do whenever. The break is
on the **caller** side: `storage.list(...)` no longer type-checks. That includes a
*proxy* typed against `IStorageService` that forwards to `inner.list`; the one in
`@objectstack/service-storage` is removed with the adapters in #5541.

**No tombstone, deliberately.** `IStorageService` is a contract that code
*implements*; nothing anywhere runs a storage adapter through a `.parse()`, so a
`retiredKey()` prescription would have no one to reach. The channel that can
carry it is `tsc`, and `tsc` reports it where it is actionable — at the call
site. This is the same disposition, for the same reason, as
`IDataDriver.findStream` (#4484). The retirement is registered as the
`storage-service-list-retired` semantic entry in the protocol-17 chain step
(ADR-0087 D3), so `spec-changes.json`, the generated upgrade guide and the
`spec_changes` MCP tool all carry it. There is no `os migrate meta` step: an
adapter is code, never stack metadata, so the chain has no source to rewrite.

**No replacement, on purpose.** A prefix listing that cannot paginate is the
wrong signature to inherit. If a first-party caller ever needs real bucket
enumeration it comes back cursor-shaped — `list(prefix, { cursor, limit })`
returning a page plus a continuation token — with adapter-conformance cases
(nested keys, directory entries, more than 1000 objects) proving both backends
agree before either ships. Maintainer ruling 2026-08-05 on #5266 chose this over
aligning the two adapters, which would have grown a conformance surface nobody
walks.

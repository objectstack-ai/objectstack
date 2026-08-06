---
"@objectstack/service-storage": patch
---

refactor(service-storage): drop `list(prefix)` from the local and S3 adapters — the implementation half of the #5540 contract retirement (#5541)

`IStorageService.list?(prefix)` was removed from the contract in `@objectstack/spec` 5.x
(#5540, ADR-0049 enforce-or-remove; analysis #5266). This removes what it left behind:
the two shipped adapters' own implementations, the tests that pinned them, and the
`'list'` label in each adapter's metrics vocabulary.

**Nothing in this repository ever called them.** The only in-repo call site was the
`SwappableStorageService` pass-through, deleted with the contract member in #5540. After
that deletion the surviving references were the two adapter methods and their own tests —
four sites, all inside `@objectstack/service-storage`, all of them producers. REST, the
CLI, the storage routes, the attachment/file-reference lifecycles and the backfill
tooling never called `list` on either adapter, on the swappable proxy, or on the
`file-storage` service. #5172 came closest and walked away: it planned to reclaim email
attachments by listing `EMAIL_ATTACHMENT_KEY_PREFIX`, found the local adapter could not
see one level down, and switched to queue-driven deferred work instead.

**What the two implementations actually did**, which is why aligning them was rejected:

| Adapter | Answered `list('a')` with |
| --- | --- |
| `LocalStorageAdapter` | one level of `readdir` — a nested key `a/b/c` was invisible, you got `a/b` — and every subdirectory `stat` succeeded on was returned as if it were a file, so `size` was a directory inode and `download()` could not fetch it |
| `S3StorageAdapter` | a recursive `ListObjectsV2` that read neither `IsTruncated` nor `ContinuationToken`, so past 1000 objects the "all files under this prefix" you got was the first page, indistinguishable from a complete answer |

One contract method, two dialects, both silently incomplete, no signal on either.

**Migration.** Callers holding the contract type were already migrated by #5540 — the
member is gone from `IStorageService`, so `storage.list(...)` stops type-checking there.
This release also removes the method from the **concrete** classes, so a caller holding a
`LocalStorageAdapter` or `S3StorageAdapter` directly loses it too:

| Wrote | Write instead |
| --- | --- |
| `new LocalStorageAdapter(...).list('attachments/task/')` | query the records you wrote — `sys_file` / file-reference rows carry the storage key and page deterministically through ObjectQL |
| `new S3StorageAdapter(...).list(prefix)` | same; for a genuine bucket sweep, call `ListObjectsV2` through the AWS SDK yourself and handle `ContinuationToken`, which is the part the adapter never did |
| a custom adapter of your own with `list?(prefix)` | nothing breaks — an extra method on a class is not a type error; delete it whenever it suits you |

Querying your own records is not a workaround for the missing method. It is the only form
that was ever correct on both backends and past 1000 objects: the bucket was never the
system of record for "which files exist" — the rows are.

**If enumeration ever comes back, it comes back cursor-shaped.** Not this signature. A
prefix listing that cannot paginate is the wrong shape to inherit, so a future
first-party need returns `list(prefix, { cursor, limit })` — a page plus a continuation
token — with adapter-conformance cases (nested keys, directory entries, more than 1000
objects) proving both backends agree *before* either ships. Maintainer ruling 2026-08-05
on #5266 chose this over aligning the two adapters, which would have grown a conformance
surface nobody walks.

Patch rather than major: the contract break was #5540's and shipped there. `tsc` cannot
see this one — a class may carry members its interface does not declare, which is exactly
why the #5540 changeset told adapter authors that leaving an implementation in place
still compiles — so the absence is held by a runtime pin,
`storage-adapter-list-retirement.test.ts`, instead.

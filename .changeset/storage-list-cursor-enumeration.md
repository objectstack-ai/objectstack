---
"@objectstack/spec": minor
"@objectstack/service-storage": minor
---

feat(spec,service-storage): restore prefix enumeration cursor-shaped — `IStorageService.list(prefix, { cursor, limit })` (#6781)

`list?(prefix): Promise<StorageFileInfo[]>` was retired in #5540 / #5541 on the
measurement "nothing in the repo calls either". True for this repo, false one repo
over: `cloud` has two production callers — tenant attachment reclamation on
environment delete (cloud#935 is the incident where that sweep silently did nothing)
and marketplace snapshot GC. Both retirement notes reserved exactly one route back,
word for word, and this is it (maintainer ruling on cloud#1203, option B).

**The new member is the reserved shape, not the old one restored.**

```ts
list?(prefix: string, options?: StorageListOptions): Promise<StorageListPage>;

interface StorageListOptions { cursor?: string; limit?: number }
interface StorageListPage { items: StorageFileInfo[]; nextCursor?: string }
```

The two defects #5266 measured in the old signature are now unrepresentable:

| #5266 defect | Why it cannot recur |
| --- | --- |
| S3 truncated at 1000 objects, no signal | A page carries `nextCursor` **iff** more remains. The 1000 is now the default `limit`, and a capped page says so instead of looking complete. |
| local listed one level, S3 recursed | One prescribed semantics — raw key-string prefix, matched recursively — asserted against **both** backends from one table in `storage-adapter-list.conformance.test.ts`. |

**Semantics every adapter must implement** (`IStorageService.list` carries the full
text): raw key prefix, so `list('a')` returns `a/b/c` *and* `ab.txt` and a trailing
slash is what scopes to a folder; files only, with filesystem directories and S3
zero-byte directory markers both skipped; ascending key order; pages full except the
last; `nextCursor` iff more remains; no duplicates and no gaps across a run.

**`limit` and `cursor` are refused, never coerced** — `VALIDATION_ERROR` / 400
(ADR-0112). The validator and the cursor codec live on the *contract*
(`resolveStorageListLimit`, `encodeStorageListCursor`, `decodeStorageListCursor`), not
in each adapter, so two backends cannot answer the same bad argument two ways. A
consequence worth knowing: a cursor means one thing everywhere — "resume after this
key" — so both shipped adapters issue byte-identical cursors and a
`SwappableStorageService` adapter swap mid-sweep resumes instead of restarting.

**Additive.** `list` stays OPTIONAL, like every other capability on this contract: a
third-party adapter that cannot enumerate is unaffected and still compiles. Making it
required would be a major-version act, and enumeration is genuinely optional for a
backend.

Shipped with it: the S3 adapter loops `ListObjectsV2` with `ContinuationToken` inside a
single call so a `limit` past the 1000-key `MaxKeys` ceiling is served in full, and
resumes across calls with `StartAfter`; the local adapter emulates the S3 key space with
a pruned walk whose memory is bounded by `limit` rather than by the size of the tree;
`SwappableStorageService` forwards it. `storage-adapter-list-retirement.test.ts` is
renamed to `storage-adapter-list-contract.test.ts` and **flipped** rather than deleted —
it used to hold "the retired shape has not crept back", it now holds "both adapters
carry the restored member, in the cursor shape and not the array one".

ADR-0087 note: the `storage-service-list-retired` ledger entry is amended, not withdrawn.
The single-argument `list(prefix)` stays retired and a call written against it still
fails to compile; what changed is the entry's `replacement`, which said "no replacement"
and would otherwise have shipped in the same release as the replacement — sending an
upgrader to hand-roll S3 pagination, which is precisely the option the ruling rejected.

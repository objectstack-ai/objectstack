// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'storage-service-list-retired',
  surface: 'contracts.IStorageService.list',
  replacement:
    'track the keys you wrote (sys_file / file-reference records, queryable through '
    + 'ObjectQL with real pagination) instead of enumerating the bucket — and where no '
    + 'such record exists, the cursor-shaped `list(prefix, { cursor, limit })` this '
    + 'entry reserved, restored in #6781',
  reason:
    '`list(prefix)` was an OPTIONAL contract method documented as "List files in a '
    + 'directory/prefix", and the two shipped adapters answered the same call with two '
    + 'different semantics — both of them silently incomplete. `LocalStorageAdapter.list` '
    + 'was a single-level `readdir`, so a nested key `a/b/c` was invisible under '
    + '`list(\'a\')` (only `a/b` came back), and a subdirectory that `stat` succeeded on '
    + 'was pushed into the result as a file, yielding a `StorageFileInfo` whose `size` is '
    + 'a directory inode and which cannot be downloaded at all. `S3StorageAdapter.list` '
    + 'was RECURSIVE (`ListObjectsV2` matches the whole key) and read neither '
    + '`IsTruncated` nor `ContinuationToken`, so past 1000 objects the "all files" a '
    + 'caller received was the first page, with no signal. One contract method, two '
    + 'dialects, both quietly incomplete — and the first feature that genuinely needed to '
    + 'enumerate a prefix (backup, orphan sweep, migration audit) would have got two '
    + 'different answers on two deployments without an error on either. #5172 was nearly '
    + 'that feature: it planned to drive attachment reclamation off '
    + '`list(EMAIL_ATTACHMENT_KEY_PREFIX)`, found the local adapter could not see one '
    + 'level down, and switched to queue-driven deferred work instead. Nothing consumed '
    + 'it afterwards: the only in-repo call site was the `SwappableStorageService` '
    + 'pass-through (which itself rejects when the active adapter has no `list`), and '
    + 'REST, CLI and the storage routes never called it. Remove was chosen over '
    + 'align-and-tighten (maintainer ruling, 2026-08-05, #5266): aligning would grow a '
    + 'conformance surface nobody walks, while a prefix listing that cannot paginate is '
    + 'the wrong signature to inherit — when a real caller needs enumeration it returns '
    + 'cursor-shaped, `list(prefix, { cursor, limit })`, with adapter-conformance cases '
    + '(nested keys, directory entries, >1000 objects) proving both backends agree. This '
    + 'is a TS/API contract surface — a storage adapter is CODE, never stack metadata — '
    + 'so there is no source for the chain to rewrite, and deliberately no schema '
    + 'tombstone: nothing ever ran an adapter through a `.parse()`, so a prescription '
    + 'there would reach no one. The enforced channel is tsc, and it reports at the call '
    + 'site. Same disposition, and the same reason, as '
    + '`data-driver-find-stream-retired` (#4484). ADR-0049 / ADR-0087, #5540 '
    + '(analysis #5266).',
  acceptanceCriteria:
    'No code calls `storage.list(...)` on the `file-storage` service or on any '
    + '`IStorageService` value. Code that needed "which files are under this prefix" '
    + 'reads the records it wrote — `sys_file` / file-reference rows carry the storage '
    + 'key and page deterministically through ObjectQL — rather than asking the bucket, '
    + 'which is also the only form that stays correct past 1000 objects and across both '
    + 'adapters. An adapter that still IMPLEMENTS `list` keeps compiling (an extra '
    + 'method is not an error on a class) and is simply unreachable through the '
    + 'contract, so deleting it is cleanup that can follow. The break is on the CALLER '
    + 'side: `storage.list(...)` no longer type-checks, and a PROXY typed against '
    + '`IStorageService` that forwards to `inner.list` is exactly such a caller — the '
    + 'one in `@objectstack/service-storage` goes with the adapters (#5541). '
    + '⚠️ AMENDED 2026-08-09 (#6781, maintainer ruling on cloud#1203, option B): the '
    + 'RESERVED route in the paragraph above was taken. `list` exists again on the '
    + 'contract, cursor-shaped — `list(prefix, { cursor, limit })` returning '
    + '`{ items, nextCursor }` — because cloud had two first-party callers this repo '
    + 'could not see when the measurement said "nothing calls it" (tenant attachment '
    + 'reclamation, marketplace snapshot GC). This does NOT un-retire anything and the '
    + 'acceptance criterion above is unchanged for what it actually governs: the '
    + 'single-argument `list(prefix): StorageFileInfo[]` is gone for good, a call written '
    + 'against it still fails to compile, and the two dialects it had are now pinned '
    + 'against each other in `storage-adapter-list.conformance.test.ts` rather than left '
    + 'to diverge. What changed for an upgrader is only the destination: prefer the '
    + 'records you wrote, and reach for the restored member when there are none.',
};

---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): four read seams that FAILED no longer answer out of an empty accumulator — only an unprovisioned table is read as truthful emptiness (#8896)

Four reads in `@objectstack/metadata-protocol` sat behind a bare `catch` that
fell through — or, in one case, jumped — above a value the read was supposed to
fill. Each handed its caller an answer indistinguishable from a legitimate one,
with nothing logged and no field saying the answer was incomplete. Per ADR-0110
D3 those are different facts, and at every one of these seams they have opposite
consequences:

- **`SeedLoaderService.loadExistingRecords()`** returned an empty `Map`. That map
  is not a cache — it IS the write decision, in all three of its callers, and
  "empty" means *write these rows*: the upsert pre-load turns every update into
  an INSERT, and `bulkWrite`'s `attempt > 1` recheck — the only thing standing
  between an at-least-once retry and a duplicate of every row the first attempt
  already committed (framework#3149) — is silently disarmed.
- **`searchAll()`** skipped the object on a per-object `catch { continue; }`
  while the response still reported `totalObjects` / `totalHits` / `truncated`
  as though the sweep had been complete: a partial scan wearing a whole one's
  numbers.
- **`findReferencesToMeta()`** dropped a whole source type on a per-matcher
  `catch { return; }`. That list answers "what would break if I delete this" and
  is rendered as the admin UI's "Used by" panel, so a silently short list reads
  as "nothing depends on it — safe to remove".
- **`publishPackageDrafts()`** did not fall through: it pushed a **fabricated**
  ADR-0067 revert-plan entry, `{ existedBefore: false, prevVersion: null }` —
  the literal opposite of the healthy branch's `existedBefore: !!activeRow`.
  `existedBefore: false` means "revert = soft-remove", so reverting that commit
  DELETES an artifact whose previous version was supposed to be restored.

None of the four `catch`es is removed; each is **discriminated by error type**,
through the same shared `isMissingTableError` predicate
(`@objectstack/metadata/errors`) that `DatabaseLoader`, `SysMetadataRepository`
and `cascadeDeleteRelations` already use:

- **benign, unchanged** — the table was never provisioned (schema sync not run
  yet). It can hold no rows, so the empty answer is the truth and each seam
  behaves exactly as before: the seed writes its rows, the search skips the
  object, the publish records `existedBefore: false`.
- **everything else now surfaces** — a connection drop, a timeout, a permission
  denial, a query error, a missing column on a provisioned table. The caller
  receives the read's own failure, envelope intact.

`findReferencesToMeta` is the one seam that gets no predicate of its own: it
reads through `getMetaItems`, which already performs exactly this discrimination
(`rethrowUnlessMetadataStoreUnprovisioned`, #5532) and raises a 503
`SERVICE_UNAVAILABLE` for a real outage. The only thing its `catch` could
swallow was that deliberate 503, so it is simply gone.

No new error code and no new response field. The behavioural change is that a
seed load, a global search, a reference scan or a package publish which used to
report success over an unreadable store now reports the failure that made it
unreadable. `publishPackageDrafts` refuses before Phase 1's transaction, so a
refused publish leaves the draft pending and writes nothing.

The comment above the publish capture claimed a capture failure "just omits that
item from the revert plan". That was wrong twice — the code fabricated rather
than omitted, and omitting would have left the item unreverted while reporting
the turn undone — and it now describes what the code does.

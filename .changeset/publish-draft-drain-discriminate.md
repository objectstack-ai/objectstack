---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): stop `promoteDraft`'s draft drain from swallowing every failure (#4981)

Publishing a draft is two writes: a transactional `put` that promotes the body onto
the active row, then a `delete` that drains the now-redundant `state='draft'` row.
The drain was guarded by a bare `catch {}` whose comment named exactly one cause —
"a concurrent publisher may have already drained the draft" — while its behaviour
covered **all** of them: connection drops, statement timeouts, missing privileges,
driver faults, `parentVersion` mismatches.

The result was a silent, self-perpetuating inconsistency. `publishDraft` returned
success, the active row was correct and durable, and a stale `state='draft'` row
stayed in `sys_metadata` holding the body that had just been published. Nothing
logged it and nothing retried it, so Studio/Setup kept reporting "unpublished
changes" for an artifact that had none, and the next publish of that artifact
promoted the same already-published body again — which overwrites the active row if
anything published or reverted in between.

**The drain now discriminates by cause.** `ConflictError` — the only error
`delete()` raises from its own pre-driver row lookup — stays silent, because both of
its arms are genuinely benign: `actualHead === null` is the concurrent-publisher
race the old comment described, and a differing head means a *newer* draft was saved
while the publish was in flight, so the surviving row is real pending work that must
not be dropped. Every other failure is reported at `error` level (per the
`warn`-vs-`error` rule: the system keeps looking healthy while something it claims to
have cleaned up is still there), naming the orphaned artifact, the consequence, and
the remedy, with the original cause attached.

**`promoteDraft` still returns success, deliberately.** The drain runs *after* the
`put` has committed, so throwing would misreport a durably successful publish as a
failure and invite the caller to retry — and a retried publish is precisely the
harmful path, because it re-promotes the stale draft. The failure is surfaced
without lying about the publish instead: alongside the log, the result carries a new
optional `draftDrainFailed` field (`{ ref, draftHash, cause }`, exported as
`DraftDrainFailure`) so callers can react without parsing logs. It is an additive
optional field on an existing result object — absent on every clean publish — so no
existing caller changes.

No protocol or spec shape changed. The drain seam is registered with
`pnpm check:durability-log-level` (as the named callee `dropPromotedDraftRow`) so
the catch cannot quietly go back to swallowing everything.

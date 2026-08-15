---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): `rollbackMetaItem` routes through the canonical type fold, closing an ADR-0010 `_lock` a plural URL spelling could address around (#8819)

`rollbackMetaItem` is the **eighth** `/meta` entry point on the
`POST /api/v1/meta/:type/:name/rollback` URL family, and it was the last one
still deriving its type key from `PLURAL_TO_SINGULAR` — the
MANIFEST-COLLECTION map #7894 moved this boundary off — instead of
`canonicalizeMetaRequestType`. The other seven fold; this one did not.

**The half of that asymmetry that was not fail-closed is the lock.**
`assertLockAllowsWrite` delegates to `getEffectiveLock`, whose artifact limb
folds and whose **overlay limb queries `sys_metadata` with the raw `type`**. The
rollback passed the caller's spelling to the gate while every row operation
below it used the folded key. So for a manifest-present type, a rollback
addressed `/meta/views/case_grid/rollback` looked the `_lock` up under a `type`
no row carries, got `'none'` back — which is not a neutral value but the verdict
"the author declared no protection" (#5706) — and then restored the history body
against the folded key, which resolves the protected row perfectly. A lock gate
addressable around from the wire, on the verb that overwrites the active body.

**The severity window is narrow and is not rounded up here.** It needs an
environment kernel (`assertLockAllowsWrite` opens with
`if (this.environmentId === undefined) return null`, skipping the gate wholesale
otherwise) **and** a lock carried by a **stored overlay row** rather than a
packaged artifact — the artifact limb folds, so an artifact `_lock` was already
found under either spelling. Inside that window the write landed.

The fold also reaches three things that were merely incoherent rather than
unsafe: the revertability tier (`isOverlayAllowed` / `isRuntimeCreateAllowed`)
took the permissive **plugin** branch for the four manifest-absent types
(`field`, `seed`, `external_catalog`, `translation`); and the
`[not_overridable]` refusal, both ADR-0010 audit rows and both receipt sentences
reported the **caller's** spelling for a row written under the canonical one.
`recordMetadataAudit` re-folds internally through `PLURAL_TO_SINGULAR`, which
covers a manifest-present plural and misses the four manifest-absent ones — so
folding at the boundary is what makes the audit trail agree with the write for
both classes.

Placed after the existing `toVersion` envelope guard rather than at the very top
of the method: that is the position `saveMetaItem` documents for this exact pair,
naming this method's opening guard its structural twin — a malformed request
envelope is refused before its type key is canonicalised, and both refusals are
`[invalid_request]`/400 either way.

**What this does not do.** `getEffectiveLock`'s overlay limb still queries the
raw `type`. Folding it there would close the class at the producer for every
present and future caller, which is the contract-first shape — but it is a
shared gate whose blast radius wants its own measurement, so it is deliberately
left open as its own card rather than ridden in here.

Pinned in `packages/objectql/src/protocol-publish-canonical-fold.test.ts` as
group D, driving the real `ObjectQL` / protocol / `SysMetadataRepository` over an
in-memory driver on an environment kernel: the canonical spelling is refused by
the lock, the plural spelling is refused by the **same** lock, and — the clause
that matters, since the first two can both pass while the write still lands —
the protected active body is **unchanged** afterwards. A positive control runs
the identical plural call with the lock removed and asserts it really does
restore the earlier body, so the group cannot pass by being unable to roll back
at all.

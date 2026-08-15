---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): route `publishMetaItem` through the `/meta` canonical-type fold (#8769)

`canonicalizeMetaRequestType` is the `/meta` request boundary, and its own
header describes it as the fold "all six entry points funnel through".
`publishMetaItem` is a **seventh** entry point on the same URL family
(`/api/v1/meta/:type/:name/publish` and the `…/published` overlay) and did not
funnel through it: it reached the draftability check through
`PLURAL_TO_SINGULAR`, the MANIFEST-COLLECTION map, which is the exact lookup
#7894 replaced at the other six. One contract, two dialects, decided by which
verb you used (Prime Directive #12).

The fix is the same one line the other six carry, at the top of the method. What
that line reaches — measured on `origin/main`, not inferred — differs by whether
the type is in the manifest map, and the two halves are not the same severity:

**The four manifest-absent types — fail-closed, but closed for the wrong reason
and with the wrong verdict.** `field`, `seed`, `external_catalog` and
`translation` are legitimately absent from `PLURAL_TO_SINGULAR` (they are not
stack collections; that absence is precisely why #7894 moved the boundary onto
the URL map). Unfolded, they arrived at the draftability check as unrecognised,
where `isRuntimeCreateAllowed`'s "no static registry entry ⇒ this is a
plugin-registered kind" arm answers **true** — the permissive plugin branch,
taken for a type the platform itself declares. So a publish addressed
`/meta/fields/showcase_task.title` PASSED a gate that `/meta/field/...` answers
`403 NOT_OVERRIDABLE`, and only failed further down, on `404 no_draft`, having
already forgotten which type it was judging. A publish addressed
`/meta/translations/zh_cn` likewise never resolved the draft that
`PUT /meta/translations/zh_cn` had folded and written under `translation`. After
the fold: the first is refused `403 NOT_OVERRIDABLE` by its real registry entry,
the second promotes the row it names.

**Manifest-present types — one lookup that did NOT fail closed.**
`promoteDraftForPublish` folds through the manifest map before the row lookup,
so a publish addressed `/meta/views/case_grid` always resolved the canonical
row. `getEffectiveLock` does not agree with it: its artifact limb folds, its
**overlay limb queries `sys_metadata` with the raw `type`**. Addressed with the
plural, the ADR-0010 `_lock` carried by the stored active row was looked up
under a `type` no row has and came back `'none'` — which is not a neutral value,
it is the verdict "the author declared no protection" (#5706) — while the
promote one line later read the folded key and overwrote the row the lock
protected. Measured on `origin/main`: `_lock: 'no-overlay'` plus a pending
draft, canonical spelling `403 ITEM_LOCKED`, plural spelling **200 and the
active body replaced**.

That window is narrow and is stated at its real width rather than rounded up: it
needs an environment kernel (the gate is skipped wholesale when `environmentId`
is `undefined`), a lock carried by a *stored overlay* row rather than a packaged
artifact, and a draft that predates the lock — because the save door refuses to
mint one once the lock is live. It is nevertheless a lock gate that could be
addressed around from the wire, and "a lock gate must not fail open" is the rule
this file already carries.

`promoteDraftForPublish`'s own `PLURAL_TO_SINGULAR` fold is **kept**, and the
measurement is the reason: that helper's other caller is `publishPackageDrafts`,
which feeds it stored row types. That is data at rest, where a legacy row
written under a plural `type` is real and nothing rewrites it on upgrade — a
different input class needing a different map, exactly as `canonicalMetaType`'s
header describes. Deleting it as "now redundant" would have changed the batch
path.

`publishPackageDrafts` and `deletePackage` need no fold of their own: neither
takes a caller-supplied `type` at all (both are addressed by `packageId`), and
the per-row work they delegate is already covered — `deletePackage` routes every
row through `deleteMetaItem`, which folds, and `publishPackageDrafts` reaches
the manifest-map fold described above.

The audit row and the publish receipt now record the canonical type too; both
read `request.type`, so a publish addressed `/meta/views/case_grid` previously
wrote `type='views'` into `sys_metadata_audit` for a row stored under `view`,
and a compliance query on the canonical spelling did not find it.

Pinned in `packages/objectql/src/protocol-publish-canonical-fold.test.ts`
against a real engine and repository, with the reverse verification's direction
predicted before it was run: predicted 3 red / 4 green, measured 3 red / 4
green, each red for its predicted reason.

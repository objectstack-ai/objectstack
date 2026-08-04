---
"@objectstack/plugin-security": patch
"@objectstack/plugin-sharing": patch
---

fix(plugin-security,plugin-sharing): the write path consults the View/Modify All Data bypass — one predicate for `security/explain` and `/data` (#4647)

A **Modify All Data** holder, a `sharingModel: 'private'` object, and a record
whose `owner_id` is NULL got two opposite answers for one
(principal, record, operation) triple:

```
POST /api/v1/security/explain  { object, operation: 'update', recordId }
  → allowed: true, layers[vama_bypass]: "View/Modify All Data bypass held
    via [admin_full_access] — ownership and sharing checks are skipped"
PATCH /api/v1/data/crm_contract/<id>
  → 403 FORBIDDEN
```

Filling `owner_id` in made the same PATCH succeed, so the write path really was
running the record-level ownership check the bypass layer said had been skipped.
`sys_attachment`'s `canEdit(parent)` gate agreed with the 403, not with explain.
Ownerless rows are not exotic: a system-context seed writes them by design (the
seed loader disables `owner_id` injection).

**The write path was the side that was wrong.** Modify All Data means an admin
edits any record regardless of ownership (the Salesforce reference frame this
platform's `modifyAllRecords` already follows, #1883), so:

- `SharingService.canEdit` / `canDelete` now consult the super-user write bypass
  **after** ownership and shares have failed, through the existing late-bound
  `ISecurityService.hasWriteBypass` probe. The `sys_attachment`
  `canEdit(parent)` gate and the sharing-rule management gate reach the same
  answer because they call the same function.
- The bypass they consult and the one `security/explain` reports are now **one
  predicate** — `PermissionEvaluator.superuserBypassSets` — rather than two
  independent readings of the permission sets. A cross-path test pins the triple
  through both `explain` and the real write middleware chain and asserts they
  agree, for update, delete and the attachment gate.

**The widening is exactly Modify-scoped.** `viewAllRecords` ("View All Data") is
a read power and never grants write: explain's `vama_bypass` layer is now
operation-aware, asking for the modify bit on a write and the view bit on a read,
and a view-only holder is refused on both paths. The probe still fails **closed**
— no `@objectstack/plugin-security`, a throwing probe, a principal-less or
on-behalf-of context all degrade to owner-only.

**Explain payload self-consistency.** For a record-grained request the top-level
`allowed` and the `record` verdict no longer contradict each other on this
triple: the row is `visible: true` with `decidedBy: 'vama_bypass'`, the
`vama_bypass` layer carries its own per-record attribution, and the `sharing`
layer credits the bypass instead of reporting "no ownership and no edit/full
share grants write" next to `allowed: true`. Where the bypass is not what
admitted the row (owner, or an admitting share) the previous `decidedBy` is
unchanged. Note that for a principal with **no** bypass, an object-level
`allowed: true` beside `record.visible: false` remains correct and intended —
`allowed` answers the object question, `record` answers the row question, and it
is the `record` verdict that the write path mirrors.

---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): stop prescribing `?force=true` on the duplicate door, which accepts no `force` (#11015)

`saveMetaItem`'s Phase 3a-destructive refusal ended every message with
`— re-submit with ?force=true to proceed.` The refusal is raised in one place
and quoted onto whatever response the caller's catch builds, so that one
sentence went out on every face that reaches the gate — including
`POST /packages/:id/duplicate`, which has no `force` to set.

Measured: the duplicate route accepts `targetPackageId`, `targetName`,
`targetNamespace`, `organizationId` and `actor` — no `force` in the query
string or the body — and `duplicatePackage`'s own request type has no `force`
field either, so its internal `saveMetaItem` call cannot carry one. The gate is
reached on the ordinary duplicate-**again** workflow, where the target
namespace already holds the renamed object from an earlier duplicate; the copy
is refused and the refusal is reported as data on a `200`:

```
"error": "[destructive_change] object/crm2_task would drop or transform existing
          data: Field 'b' removed — … — re-submit with ?force=true to proceed."
```

A caller who does what that sentence says gets the identical refusal back. The
remedies that do exist on that face — duplicate into a target namespace that is
free, or reconcile the colliding object first — were never stated.

The clause is now rendered per face. The duplicate door says:

```
… — this copy cannot be forced: the duplicate door accepts no `force`.
Duplicate into a target namespace that does not already hold 'crm2_task', or
reconcile that item with the source first.
```

Three narrowings, each pinned:

- **The clause is repaired, not the door.** No `force` parameter is added to
  `POST /packages/:id/duplicate`; that would widen a public surface and is a
  contract decision, not a message fix. Which face is being served is stated by
  the server on the internal call, exactly as `source` already is — a caller
  cannot smuggle one in.
- **Nothing else in the message moved.** #10886 measured that
  `duplicatePackage`'s `failed[].error` is the sole carrier of the per-field
  destructive findings, so the findings prose stays verbatim. Only the trailing
  remedy sentence is face-dependent.
- **No accept/reject behaviour changed.** The copy is still refused, still
  reported as `failed[]` data on the `200`, still counted. Faces that state no
  door — the single-segment REST `PUT /api/v1/meta/:type/:name`, where
  `?force=true` is a real query parameter the route threads — keep the previous
  wording byte for byte.

---
"@objectstack/runtime": minor
---

Add `POST /api/v1/automation/:name/clone` — whole-definition flow clone (ADR-0126 §7.1)

An admin who cannot edit a packaged flow in place can now copy it to an ordinary
org-authored sibling and edit that instead. `POST /automation/:name/clone` takes
`{ name, label }` — both mandatory — and registers a copy of the source flow's
parsed definition under the new machine name.

**The copy is whole-definition, never an enumerated facet list.** Every key the
source definition carries comes across; exactly `name`, `label` and `status` are
mutated. This is the shape ADR-0126 §7.1 rules for, and the reason is measured:
a clone assembled from an enumerated facet list silently dropped three of six
facets (#11703) — the record was created, the success toast fired, and the
difference was discoverable only by diffing the two rows. A flow has far more
facets than a permission set, so the acceptance test asserts deep equality of
the cloned definition against its source minus those three fields; a dropped
facet fails the test rather than shipping.

**The new machine name is mandatory and a same-name clone is refused** with a
409 `RESOURCE_CONFLICT` naming both the reason and the remedy. Not because
storage rejects it — storage legitimately holds both rows — but because the
automation engine keys flows by bare name, so a second definition under one name
silently shadows the other and which of the two dispatches depends on
registration order.

**No ancestry is recorded.** Nothing tracks what a clone was copied from — no
provenance field on the definition, none on the response (ADR-0126 amendment
ruling 2, §9). The source's own ADR-0010 protection envelope (`_packageId`,
`_provenance`, `_lock`, …) is dropped rather than carried across, so the clone is
an org-owned flow the admin can actually edit rather than a second copy of the
package's locked artifact.

**References are not re-pointed** — no reference index exists, so the clone calls
exactly what the original called. The response says so, along with the fact that
`status: 'draft'` is a lifecycle label and not an off-switch: the engine only
disables on `obsolete`/`invalid`, so a cloned record-change or schedule flow is
bound to its trigger and runs alongside the flow it was copied from.

The route joins the `manage_metadata` authoring-write set (#10145/#10243) — it
registers flow metadata at environment scope, exactly as `POST /automation` does.

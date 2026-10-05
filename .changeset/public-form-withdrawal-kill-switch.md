---
'@objectstack/rest': patch
'@objectstack/metadata-protocol': patch
'@objectstack/metadata-core': minor
---

A public form's explicit intake withdrawal at any metadata layer now holds: layering can only narrow anonymous intake, never re-open it

Clause-②: yes (widening)

- **What counts as a withdrawal.** A withdrawal keeps the form's `publicLink` and sets `sharing.enabled: false` or `sharing.allowAnonymous: false`. Only an explicit `false` counts: a switch that is absent is not a withdrawal. Removing the `sharing` block, clearing the `publicLink`, or deleting the view at one layer is not a withdrawal either. A sharing that names no public link withdraws nothing.
- **What counts as the same form.** A withdrawal closes the same form across layers, and identity is the stored view definition (the row an overlay is keyed by). Inside that definition, a withdrawn form matches by its place (`form`, the same `formViews` entry, or `config`) or by its public slug. Either match is enough, so moving the form to another key or place, renaming it, or pointing its link at a new slug (including a change of letter case) does not escape. A form that differs from every withdrawn form in both place and slug, such as a sibling in the same container, stays independent. A different view that uses the same slug is a different form, and the two never close each other.
- **Anonymous form doors.** `GET /forms/:slug` and `POST /forms/:slug/submit` serve a form only when the env-wide layer beneath the organization's read does not withdraw the same view, matched by name and then by place or slug. A withdrawn form answers `404 FORM_NOT_FOUND` on both doors and creates no record. A form that is open at every layer is served as before. A form that only an organization carries is still served there.
- **Behaviour change.** Between 17.6.0 and this fix, an organization overlay that published a form the environment-wide (package) definition withdrew was honoured: the doors served the organization's copy. That behaviour never shipped in a release, and it is reversed on purpose. The environment-wide withdrawal now wins.
- **Organization-scoped saves.** A `view` save or draft promotion in the organization the doors read is refused with `403 NOT_OVERRIDABLE` if it would leave open a form that the environment-wide definition withdraws. The save is judged twice: once against the env-wide view list, the way the doors read it (a container-shaped body is expanded the way the list read expands it), and once against the env-wide body of the same stored row. This holds even when the organization's copy was already open before the withdrawal. The message names the remedies: save the overlay withdrawn, or publish the form from its environment-wide definition. An organization-scoped save that keeps the form withdrawn is still accepted. Rollback and commit-revert restores are not gated by this judgement yet.
- **`@objectstack/metadata-core`** exports the shared judgement `anonymousFormIntakeWithdrawnIn` (a new, additive public export). Both the doors and the save path read it.

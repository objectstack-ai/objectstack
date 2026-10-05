---
'@objectstack/rest': patch
'@objectstack/metadata-protocol': patch
'@objectstack/metadata-core': minor
---

A public form's explicit intake withdrawal at any metadata layer now holds: layering can only narrow anonymous intake, never re-open it

Clause-②: yes (widening)

- **What counts as a withdrawal.** A withdrawal keeps the form's `publicLink` and sets `sharing.enabled: false` or `sharing.allowAnonymous: false`. It closes the same form only: the same view, at the same place in it (`form`, the same `formViews` entry, or its `config`), across its metadata layers. A different view that uses the same public slug is a different form, and the two never close each other. Removing the `sharing` block, clearing or changing the `publicLink`, or deleting the view at one layer is not a withdrawal. A sharing that names no public link withdraws nothing, whether it is a raw body or a schema-parsed one whose `enabled`/`allowAnonymous` defaults read `false`.
- **Anonymous form doors.** `GET /forms/:slug` and `POST /forms/:slug/submit` serve a form only when no layer they read withdraws it. A withdrawn form answers `404 FORM_NOT_FOUND` on both doors and creates no record, whatever another layer says. A form that is open at every layer is served as before. A form that only an organization carries is still served there.
- **Behaviour change.** Before this release, an organization overlay that published a form the environment-wide (package) definition withdrew was honoured: the doors served the organization's copy. That is reversed on purpose. The environment-wide withdrawal now wins, and the organization's copy cannot re-open the form.
- **Organization-scoped saves.** A `view` save in the organization the doors read is refused with `403 NOT_OVERRIDABLE` if it would leave open a form that the environment-wide definition withdraws. This holds even when the organization's copy was already open before the withdrawal, so re-saving that overlay is refused too. A container-shaped body (`formViews`, `form`) is judged the way the list read expands it. The message names the remedies: save the overlay withdrawn, or publish the form from its environment-wide definition. An organization-scoped save that keeps the form withdrawn is still accepted. Rollback and commit-revert restores are not gated by this judgement yet. The doors still keep such a form closed.
- **`@objectstack/metadata-core`** exports the shared judgement `anonymousFormIntakeWithdrawnIn` (a new, additive public export). Both the doors and the save path read it.

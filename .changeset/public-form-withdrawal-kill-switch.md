---
'@objectstack/rest': patch
'@objectstack/metadata-protocol': patch
'@objectstack/metadata-core': minor
---

A public form's intake withdrawal at any metadata layer now holds: layering can only narrow anonymous intake, never re-open it

Clause-②: yes (widening)

- **Anonymous form doors.** `GET /forms/:slug` and `POST /forms/:slug/submit` serve a public form only when no metadata layer they read withdraws it. A form withdrawn at one layer (`sharing.enabled: false` or `sharing.allowAnonymous: false`, or its public link named by a sharing that does not open it) answers `404 FORM_NOT_FOUND` on both doors and creates no record, whatever another layer says. A form open at every layer is served as before, and a form only an organization carries is still served there.
- **Organization-scoped saves.** A `view` save that would re-open a public form another layer withdrew is refused with `403 NOT_OVERRIDABLE`, and the message names the remedy: publish the form from its environment-wide definition. An organization-scoped edit that keeps the form withdrawn, or that leaves its intake as it is, is still accepted.
- **`@objectstack/metadata-core`** exports the shared judgement, `anonymousFormIntakeWithdrawnIn` and `anonymousFormWithdrawnSlugs` (new, additive public exports), which both the doors and the save path read.

---
"@objectstack/rest": patch
---

fix(rest): an anonymous public-form submit that leaves a form-required field empty answers `400 VALIDATION_FAILED` naming the field, and stores nothing

Clause-②: yes

- **What changed.** `POST /forms/:slug/submit` now enforces the form's own `required`: a section entry `{ field: 'email', required: true }` is judged before the write, with the rule the engine's object-level check uses (`isEmptyForRequired` from `@objectstack/core`). A submission whose value for such a field is absent, `null`, `''`, only whitespace, or `[]` on a multi-value field is refused, and no row is created. Before, the engine judged only the fields the OBJECT requires, so a field only the form required answered `201` and was stored empty — while the rendered form refused the same submission.
- **The refusal** is the object-level one's envelope on this route, key for key: `400` with top-level `code: 'VALIDATION_FAILED'`, `error` (the messages), and `fields[]` of `{ field, code: 'required', message, label }`, worded by the same validation catalog (for example `Email is required`). Every empty form-required field is named in one refusal, in the form's order.
- **Narrowing — who it affects.** A script or integration that posts to a public form and omits a field the form marks `required: true` now gets `400` instead of `201`. The fix is to send that field, or to remove `required: true` from the form entry if the field is optional. Nothing that was refused before is accepted now.
- **Judged only where the form asks.** An entry the form hides (`hidden: true`), or shows only conditionally (`visibleWhen` on the entry or on its section), is not judged — nothing server-side evaluates a form-view `visibleWhen`. A server-managed anchor (`owner_id`, `organization_id`, …) is never written by this route, so it is never judged. An object `defaultValue` or a `beforeInsert` hook does not satisfy a field the visitor omitted: the route judges what the visitor sent.

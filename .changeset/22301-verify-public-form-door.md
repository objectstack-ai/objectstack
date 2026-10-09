---
'@objectstack/verify': patch
---

docs(verify): `hooks.run` names the anonymous public-form door a booted stack already serves

Clause-②: no

An app's web-to-lead or web-to-case branch runs on an anonymous public-form submission, and a booted stack already serves that write: it is the form's own route, `api('/forms/:slug/submit', { method: 'POST', body })` with no token. `bootStack` mounts that route, and the in-process handle has no method for it, by design: its one owner is `@objectstack/rest`. Nothing changes in what the package does. `hooks.run`'s documentation now names the door, so a suite reaches it instead of calling the engine with a hand-built guest context.

What the door does, as the package's own tests now pin it on a booted stack:

- It hands the engine the route's own context: the form's one-object grant, the `guest_portal` permission set, and `anonymous`. There is no user and no system principal.
- A bound hook sees no session and no user, so an app's guest branch runs, and the record-change trigger fires the object's flows with no trigger user.
- It keeps only the fields the form collects and answers `201` with `{ id }`. Read the row back with `rows(object, { id })`.
- An unknown slug, or a form that is shared but not anonymous, is answered `404` with `code: 'FORM_NOT_FOUND'`, and nothing is written.

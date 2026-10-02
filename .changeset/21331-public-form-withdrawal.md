---
'@objectstack/rest': patch
---

Withdrawing a public form from anonymous intake now takes effect on every intake door

Clause-②: no

When an administrator withdraws a public form, both anonymous form routes (`GET /forms/:slug` and `POST /forms/:slug/submit`) now answer `404 FORM_NOT_FOUND` and no record is created. Republishing the form restores both routes. If a service the routes need to resolve the form is registered but cannot be reached, both routes refuse the request instead of serving the form.

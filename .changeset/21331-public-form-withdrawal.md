---
'@objectstack/rest': patch
---

Withdrawing a public form from anonymous intake now takes effect on every intake door. The anonymous form routes (`GET /forms/:slug` and `POST /forms/:slug/submit`) read the form in the same scope an administrator's form editor shows, so a form an administrator has withdrawn is answered `404 FORM_NOT_FOUND` on both routes and no record is created. Republishing the form restores both routes. If the deployment's tenancy service is registered but cannot be reached, both routes now refuse the request. They no longer serve the form from a partial read.

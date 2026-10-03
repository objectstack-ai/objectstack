---
'@objectstack/rest': patch
---

Public forms on a walled tenancy posture: a form whose object is walled by an organization column is no longer offered to anonymous visitors. An anonymous submission carries no organization, and on a walled posture an insert into such an object without one is refused, so the form used to render and then answer `500 ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` on every submit. Both anonymous form endpoints (`GET /forms/:slug` and `POST /forms/:slug/submit`) now answer it exactly as they answer a withdrawn form (`404 FORM_NOT_FOUND`), so an anonymous caller learns nothing about the deployment's tenancy. The administrator's read of the form (`GET /meta/view/:name`) states why in `_diagnostics.warnings`, located at the form's `sharing`, with the remedy: if the object's rows belong to no organization, declare `tenancy: { enabled: false }` on it. Forms bound to tenancy-disabled objects, and single-posture deployments, are unchanged.

Clause-②: no

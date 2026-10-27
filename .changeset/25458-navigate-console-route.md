---
'@objectstack/spec': patch
---

docs(spec): `onSuccess.navigate` and a `type: 'url'` action's `target` say that an in-app path is an app-qualified console route (`/apps/APP/OBJECT/record/ID`) (#25458)

Clause-②: no
Metadata-protocol: none

Wording only; no schema accepts or refuses anything new. The describe text of `ActionSchema.onSuccess.navigate` and of `ActionSchema.target` said "an in-app path starting with / or ./" and never said which path. They now say that an in-app path is a console route, written without the console's mount prefix, and that a record is `/apps/APP/OBJECT/record/ID`. `APP` is the app's route segment (ADR-0048): its package id, and its `name` also resolves. No app-relative form is declared and no `${ctx.*}` member names the current app, so write the app segment. The docblock example `/apps/crm/tasks/${result.id}` becomes `/apps/crm/tasks/record/${result.id}`, the route it was only redirected to.

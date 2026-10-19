---
'@objectstack/skills': patch
---

docs(skills): `objectstack-api` states that a public form's submit is authorized by the form's own `publicFormGrant`, and that the `guest_portal` name on the submit context admits nothing and needs no permission set (#24239)

Clause-②: no

`skills/objectstack-api/SKILL.md` described the anonymous form endpoints as running under a synthetic `{ permissions: ['guest_portal'], anonymous: true }` execution context and named nothing else, so an author reading it inferred that a `guest_portal` permission set authorizes the submit and declared one, or concluded that the form falls open without one. Neither is true: the submit is authorized by the form's own declaration (ADR-0056 Option A) — the route hands the engine a `publicFormGrant` scoped to the form's target object, which admits the create and the read-back of the row it made and nothing else, decided before any permission set resolves. The `guest_portal` name on the context admits nothing; where a deployment registers a set under it, that set only feeds the grant's result masker. The passage now says so, matching `content/docs/ui/public-data-collection.mdx` and the `registerFormEndpoints` docstring in `@objectstack/rest`. Text only; nothing an author writes changes, and the form routes' behaviour is unchanged.

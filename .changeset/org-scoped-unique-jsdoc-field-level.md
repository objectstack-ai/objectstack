---
"@objectstack/driver-sql": patch
---

docs(driver-sql): `isOrganizationScopedUnique` documents the FIELD-level spelling only

The exported helper's JSDoc claimed it judged organization scope "on either
spelling (field-level `unique` or a declared index's `unique`)". It does not,
and never did: both of its call sites pass `field.unique`, while
`normalizeDeclaredIndex` scopes a declared index with a strict
`idx?.unique === 'organization'` — so a declared index's bare `unique: true`
is taken verbatim as global.

That divergence is deliberate (the #4986 answer, ADR-0120 D1), but the comment
invited the tidy-up that would erase it — routing the declared-index branch
through the helper, which is option 1 of #8323 (⛔ rejected by the maintainer,
2026-08-13) and pre-empts the bare-spelling question parked on #5082. The
corrected JSDoc states what the helper actually judges, points at
`normalizeDeclaredIndex` and #5082, and records why unifying the two paths is
rejected: it would silently reinterpret every existing declared `unique: true`
on deployed databases as organization-scoped.

Documentation only — no behaviour, signature or type change. Shipped as a patch
because the helper is a top-level export of the package entry point and
`declaration: true` with no `removeComments` puts this text in the published
`dist/index.d.ts` a consumer reads.

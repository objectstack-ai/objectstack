---
'@objectstack/plugin-security': patch
'@objectstack/rest': patch
'@objectstack/spec': patch
---

fix(security): public-form submissions can no longer forge server-managed anchors (#3022)

The anonymous public-form surface (ADR-0056 Option A, `POST /forms/:slug/submit`)
is authorized by the declaration-derived `publicFormGrant`, which short-circuits
the security middleware BEFORE every write gate (CRUD, FLS, the owner anchor
guard, the tenant CHECK). The only field-side defense was the route's
declared-field allow-list — and a FormView with zero declared section fields
fell back to merging the raw body wholesale, so an unauthenticated visitor
could `POST owner_id=<victim>` (or `organization_id`, audit columns, `id`) and
attach the record to another user or tenant — the #3004 insert-forge, with no
credentials at all.

Server-managed anchors are now enforced on this surface at BOTH layers, from a
single shared definition (`PUBLIC_FORM_SERVER_MANAGED_FIELDS`, new in
`@objectstack/spec/security`):

- **Data layer (authoritative)** — the `publicFormGrant` branch in
  `@objectstack/plugin-security` strips `id` / `owner_id` / `organization_id` /
  `tenant_id` / audit columns / soft-delete state / `__search` from every row
  of a granted insert (batch included) before admitting the write, so the
  boundary holds no matter what any route lets through. Ownership stays NULL
  for object hooks / the first-admin bootstrap to assign, as for other
  anonymous-seeded rows.
- **Route layer** — the submit allow-list excludes the same set
  unconditionally: an explicitly declared `owner_id` section field no longer
  passes, and the zero-declared-sections fallback keeps its documented
  all-fields behavior for business columns while refusing the managed set.
  The resolve route (`GET /forms/:slug`) drops the managed fields from the
  rendered sections and the embedded object schema so a form never collects a
  value the submit refuses, and `GET /forms/:slug/lookup/:field` refuses a
  `publicPicker` declared on a managed anchor (which would have opened
  anonymous `sys_user` search through `owner_id`).

Authenticated writes are unaffected — this is the anonymous-surface rule only;
`owner_id` transfer semantics for signed-in callers stay governed by the
transfer grant (#3004 / PR #3018).

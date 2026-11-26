---
'@objectstack/spec': minor
'@objectstack/rest': minor
'@objectstack/runtime': minor
'@objectstack/lint': minor
'@objectstack/setup': minor
'@objectstack/studio': minor
'@object-ui/app-shell': minor
'@object-ui/i18n': minor
---

feat(spec): a book audience can name a capability, so the Setup and Studio docs open only for callers who can open those apps

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: none — no `skills/` page teaches the book audience forms; `content/docs/ui/doc-pages.mdx` documents the new form in this change

A book's `audience` (ADR-0046 §6.7) takes a fourth form, `{ systemPermission: 'TOKEN' }`: the book's pages are read by a signed-in caller who holds that capability through any permission set, the same caller an app with `requiredPermissions: ['TOKEN']` opens for. `{ permissionSet }` names one set, so it could not gate a manual on a capability several sets grant (`setup.access` comes with `organization_admin`, `admin_full_access` and any delegated-admin set an application authors).

- **`@objectstack/spec`.** `BookAudienceSchema` and `BookAudience` gain the arm. It is strict, so `{ systemPermission, label }` is refused at parse; an object that also carries `permissionSet` still parses as the older, non-strict `{ permissionSet }` arm with the other key dropped, as before. `BookAudience` is a wider union now: TypeScript code that reads `.permissionSet` after a bare `typeof audience === 'object'` check narrows by key instead (`'permissionSet' in audience`). `AudienceCaller` gains `systemPermissions`, and `audienceAllows` admits the arm only when that list holds the token; an absent list denies (fail closed). Every other form answers as before.
- **`@objectstack/rest`.** The docs audience reads the caller's own `systemPermissions` (the list every `requiredPermissions` arm of the `/meta` read gate reads) when some book carries the new form, on `GET /meta/doc` (with and without `?include=content`), `GET /meta/doc/:name`, `GET /meta/book`, `GET /meta/book/:name/tree` and the app-nav `doc` entries. New: `anySystemPermissionAudience`, and the optional `resolveAudienceSystemPermissions` port on `MetaReadGateAudienceSources` for a transport whose audience reads someone else's holdings.
- **`@objectstack/runtime`.** The MCP docs tools (`search_package_docs`, `read_package_doc`) gate on the same form; on an OAuth grant they read the delegating person's own capabilities, never the token's ceiling.
- **`@objectstack/setup`, `@objectstack/studio`.** Each package now ships a manual (`setup_manual`, `studio_manual`) claiming its package's doc namespace (`setup_*`, `studio_*`), gated on `setup.access` / `studio.access`. Before, those docs were claimed by no book, so they fell back to `org`: listed to administrators only by the Console's docs index, but readable at their address, and through `?include=content`, by every signed-in member. Now a member who cannot open Setup gets `setup_overview` in neither list and a `403 PERMISSION_DENIED` on its read; an administrator reads it as before. The docs' Console address now names the manual (`/apps/com.objectstack.setup/docs/setup/setup_overview`) in place of the package's implicit one; the flat `/docs/setup_overview` permalink still finds it.
- **`@objectstack/lint`.** `capability-reference-unknown` also resolves a book's `audience.systemPermission`, so a misspelled capability (which hides the manual from everyone) warns.
- **`@object-ui/app-shell`, `@object-ui/i18n`.** Studio's book preview shows a capability-gated book as "Capability: TOKEN" instead of "Org", and the book form round-trips the new form.

Nothing to migrate: the manuals claim by name, so a stored doc bound to no package (which a package-scoped `include: '*'` would also have claimed) keeps the audience it had. Only docs named under those prefixes change audience: on `main` that is `setup_overview` and `studio_overview`.

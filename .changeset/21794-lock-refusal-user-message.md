---
'@objectstack/plugin-security': minor
---

The packaged-permission-set lock refusal carries its guidance as `userMessage`, so the console tells the admin to clone the set instead of showing its generic "You don't have permission to save this record." (#21794).

Clause-②: yes (widening)

- **`PackagedPermissionSetLockedError.userMessage`**, a new `readonly` member. A save that targets a permission set an installed package ships still answers `403 NOT_OVERRIDABLE` with the same `message`. That holds at the data door (`PATCH` / `POST /api/v1/data/sys_permission_set`) on every kernel. It also holds at the metadata door (`PUT /api/v1/meta/permission/:name`) on a kernel with no environment id, such as a self-hosted app server, where this lock is the refusal that answers. On an environment kernel the metadata protocol's own package-door refusal answers that `PUT` first, and it is unchanged. The error envelope now also carries `userMessage`, the field `ApiErrorSchema` already declares and the console renders verbatim. An edit is told to clone the set with the Clone action and edit the clone. A new set named like a packaged one is told to choose a different name, or clone.
- **`PackagedPermissionSetProvenanceUnknownError.userMessage`**, the same member on the fail-closed refusal (the platform could not tell whether a package ships the set). It tells the admin to try again, or clone. The unreadable source stays in `message`.
- The texts name no set, package, id or API path; `message` keeps that diagnostic for logs and developers. They are English, like every platform refusal.

Nothing that was accepted is refused now, and nothing that was refused is accepted. Both refusals keep their `code`, `status` and `message`.

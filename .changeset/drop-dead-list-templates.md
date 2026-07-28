---
"@objectstack/client": minor
---

feat(client)!: delete `projects.listTemplates()` — it targeted a route nothing
has ever mounted (#3702, #3655 finding)

`client.projects.listTemplates()` built `GET /api/v1/cloud/templates`. That
path is mounted by **nothing**: none of the 17 registrars in `cloud`'s
`cloud-artifact-api-plugin.ts` (91 registrations, enumerated by driving them
against a capturing mock `IHttpServer`), and nothing in this repo — the string
occurred exactly once in each repo, at the call itself. Every invocation was a
404 with a type signature promising a resolved value.

"Templates" are real as **data** — `sys_package_templates`, the
`is_starter = true` view over `sys_package`, rendered as a console page — but
there has never been an HTTP route that lists them, and no caller in either
repo (nor in `objectui`) used the method. Mounting a route to satisfy a method
nobody calls is the wrong order: the client's declared shape
(`{ id, label, description, category? }`) does not match `sys_package`'s
columns, so picking that mapping is a product decision, not an implementation
detail. The method returns when a route exists to back it.

Sixth instance of the `the method exists ≠ the method can be called` class this
audit family keeps finding, after `analytics.explain` / `analytics.meta`
(#3584), `meta.getView` (#3611) and `i18n.getTranslations` / `getFieldLabels`
(#3636) — and the first one only a cross-repo guard could see. The framework
capstone (#3642) exempts the `/api/v1/cloud/` prefix wholesale, because this
repo does not serve those routes; `cloud`'s control-plane ledger (#3655) is
where the mounted set and the SDK are both in scope, and it pins the absence.

Callers who somehow depended on it were already receiving a 404; read starter
packages through the `sys_package` view (`is_starter = true`) instead.

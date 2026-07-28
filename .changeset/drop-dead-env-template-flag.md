---
"@objectstack/client": minor
"@objectstack/cli": minor
---

feat(cli,client)!: drop `os environments create --template` and the
`template_id` body field — no control plane has ever read them (#3731)

The CLI advertised `--template` as *"Built-in template id (e.g. crm, todo,
blank)"* and forwarded it as `template_id` on `projects.create()`. Nothing
consumes it: `template_id` / `templateId` appears in **zero** non-test files in
the `cloud` repo, `sys_environment` has no such column, and the create route
whitelists what it reads (`displayName`, `organizationId`, `isDefault`,
`hostname`, `metadata`, …) — `template_id` is not in the list. The
`blank`/`crm`/`todo` registry the flag named was the `apps/server`
`createTemplatesRoutePlugin` snapshot, removed when the control plane moved to
`cloud`; the flag outlived it.

So the flag was accepted, transmitted, and dropped — no seeding, no error, no
stored trace. That is worse than the 404 its listing counterpart returned
(`projects.listTemplates`, deleted in #3702): a 404 tells the caller something
is wrong, a silently ignored flag reports success.

**Migration.** `os environments create --template <id>` → drop the flag; it
never did anything. Starter content comes from the App Marketplace: create the
environment, then install the package (`sys_package` rows with
`is_starter = true`, i.e. `client.projects.packages.install(envId, { packageId })`).
Callers passing `template_id` to `client.projects.create()` should delete the
property — TypeScript now rejects it, which is the point: an unknown field was
being silently discarded on the wire.

Note this is **not** the same `--template` as `os init` / `create-objectstack`
(`app` / `plugin` / `empty` scaffolds) — those are local scaffolding templates
and are untouched.

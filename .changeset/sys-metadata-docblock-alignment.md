---
"@objectstack/spec": patch
---

docs(spec): stop teaching `sys_metadata` as still keyed by `environment_id`

Prose only — no behaviour change. The `environment.zod.ts` module docblock
listed `sys_metadata` among the Control-Plane tables **"(with `environment_id`)"**,
alongside the correct `sys_package_installation` (with `environment_id`)`
entry (ADR-0003, UNIQUE `(environment_id, package_id)`), which is untouched.

That parenthetical ships verbatim to two consumer-facing surfaces: the docs
site (`content/docs/references/cloud/environment.mdx`, auto-generated from
this docblock) and the published `.d.ts` — an editor tooltip for anyone
importing `@objectstack/spec/cloud`.

On the metadata tables, `environment_id` is retired, not live (AGENTS.md:8;
ADR-0006 v4; `packages/metadata-core/src/objects/sys-metadata.object.ts` and
`packages/metadata/src/loaders/database-loader.ts` both carry `@deprecated`
notes to the same effect, and the loader's test pins `organization_id` in the
write path with no `environment_id` filter anywhere). The docblock's own
parenthetical was the one place still teaching the opposite.

The replacement wording matches `AGENTS.md:8` exactly: it asserts only that
`environment_id` is deprecated on the metadata tables in favor of
`organization_id`, and says nothing about whether the cloud control plane's
own `sys_metadata` table still keys by it — a fact this tree cannot settle.
That framing is true under either reading, so it does not require resolving
which one holds.

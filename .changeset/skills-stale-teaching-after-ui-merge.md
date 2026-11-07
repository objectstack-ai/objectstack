---
'@objectstack/skills': patch
---

docs(skills): drop the "separate objectui repo" teaching, list objectui in the catalog index, repair three dead anchors, and author `sharingModel` in the object examples

Clause-②: no
Metadata-protocol: none

- `objectui`: the README installs the skill from `@objectstack/skills` with the pinned `experimental_sync` command the catalog README teaches, instead of `npx skills add objectstack-ai/objectui`, and its source link and `page-builder.md`'s `plugin-gantt` link point at `ui/` in this repository. The catalog README's "Related repositories" entry points there too.
- The generated skill index in `skills/README.md` and the docs Skills reference now list `objectui` (eleven skills). The generator admits every skill directory with a `SKILL.md` that is not `metadata.internal`, instead of only `objectstack-*` names.
- Dead links fixed: `data-hooks.md`'s reference to a hooks section the data `SKILL.md` no longer has is removed, and `plugin-lifecycle.md` / `service-registry.md` point at `references/plugin-development.md`, where the Complete Plugin Example and the Well-Known Plugin Names table live.
- `bootstrap.md`'s starting `package.json` pins `18.3.0`, the version every skill now carries.
- Every complete `ObjectSchema.create` example in `relationships.md`, `lifecycle.md` and `datasources.md` authors `sharingModel`, because a publish without one is refused with `security-owd-unset`. Master-detail children use `controlled_by_parent`, and the read-only external object uses `public_read`.
- `indexing.md`: the tenant column is `organization_id`, injected by `systemFields.tenant`, not an authored `tenant_id`.
- `objectstack-query`: teaches `$empty`, the is-empty-by-declared-type operator that the view filters `is_empty` / `is_not_empty` lower to.
- `objectstack-upgrade`: the `skills remove` roster says `objectstack-pm-dispatch` is not in the 18 catalog.
- New eval cases cover the authored `sharingModel`, the `organization_id` tenant index and `$empty`. The touched files stay inside their token ceilings by removing restatements in the same files. No schema, key or behaviour changes.

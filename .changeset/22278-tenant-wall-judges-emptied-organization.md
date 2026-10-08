---
'@objectstack/plugin-security': minor
---

fix(plugin-security)!: the Layer 0 tenant write wall refuses a non-system update that would leave a row with no organization

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export, type or stored shape is added, removed, renamed or re-shaped, and no stored row is read, rewritten, converted or dropped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is a runtime write door: where the Layer 0 tenant wall applies, a non-system update that would store a row with no organization is refused with the existing 403 PERMISSION_DENIED envelope. The other categories are closed on facts: the one bumped package publishes (not unpublished); no ADR-0087 id covers this path and this diff adds none (not registered / already-registered); and nothing exported is removed or narrowed, so it is neither runtime-interface-only nor type-surface-only. -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

**What stops being accepted.** Under a walled tenancy posture (`isolated` or `group`), on an object the Layer 0 tenant wall covers, a non-system update that would leave the row with no organization is refused with `403 PERMISSION_DENIED`. That holds for the value the caller sends and for the value the stored row ends up with after the `beforeUpdate` hooks, on the by-id and the predicate update paths alike, and for every non-system caller the wall covers, platform administrators on public tenant objects included. The rule the wall already stated for an update, that a row's organization stays one the caller's organization scope admits, now covers "no organization" as well as "another organization". An organization-less row is not inert: on an ordinary tenant object it leaves every reader's scope, and on the organization-scoped grant tables (`sys_user_position`, `sys_user_permission_set`) it is read as a grant that applies in every organization.

**What stays accepted.**

- An update that does not touch `organization_id`, and one that keeps the row's own organization.
- System-context writes (seed replay, imports, migrations, platform bootstraps).
- A platform administrator on an object whose posture permits crossing the wall, as before.
- The `single` posture, where no tenant wall applies.
- Inserts: an absent or empty organization on an insert is still filled with the caller's active organization.

**What changes for you.** A script or flow that cleared a row's organization through a user or service-principal context now receives the `403` above. Keep the row in its organization; if a row genuinely must carry no organization (a global grant, for example), write it from a system context.

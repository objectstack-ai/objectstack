---
'@objectstack/rest': minor
'@objectstack/runtime': minor
---

fix(rest,runtime)!: the authoring-trail doors (`/meta` history, audit and diff, and package commits) stop admitting `setup.access`, so an organization admin is refused the environment's authoring trail

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A runtime admission narrowing at four read doors, not a metadata change. No spec key, option, config field, response field, error code or stored shape is removed, renamed or re-shaped, and no export is added or retired: the new predicate and gate are module-private. A caller these doors still admit receives the same answer as before, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is which callers these doors serve: a caller holding `setup.access` and neither `studio.access` nor `manage_metadata` is now refused with 403 at all four doors, and at the commits door so is a caller holding `setup.access` and `manage_metadata` without `studio.access`. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id covers these doors and this diff adds none (not registered, not already-registered); nothing published is retired or re-typed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

Organization admins hold `setup.access`. Under a wall (the `isolated` and `group` postures), these four doors handed every organization's admin the environment-wide authoring trail of items no organization authors (ADR-0131 C5): who saved each item and when, its superseded bodies, and every package's commit timeline. The data door on the same three tables (`sys_metadata_history`, `sys_metadata_audit`, `sys_metadata_commit`) refuses them (`requiredPermissions: ['studio.access']`, ADR-0131 D7), and the doors now follow the same rule. The narrowing applies in every posture, `single` included.

Each door, and the callers it now refuses:

- **BREAKING** `GET /meta/:type/:name/history` (`@objectstack/rest`), for a caller holding `setup.access` and neither `studio.access` nor `manage_metadata`: was 200 with the item's version history; now `403 FORBIDDEN`.
- **BREAKING** `GET /meta/:type/:name/audit` (`@objectstack/rest`), for the same caller: was 200 with the item's audit rows; now `403 FORBIDDEN`.
- **BREAKING** `GET /meta/:type/:name/diff` (`@objectstack/rest`), for the same caller: was 200 with a diff of the item's stored versions; now `403 FORBIDDEN`.
- **BREAKING** `GET /packages/:id/commits` (`@objectstack/runtime`), for a caller holding `setup.access` without `studio.access`, **with or without `manage_metadata`**: was 200 with the package's commit timeline; now `403 PERMISSION_DENIED`.
  - `manage_metadata` never admitted this door. A caller holding it alone was refused before and still is; a caller holding it beside `setup.access` was admitted only through `setup.access`.
  - One such caller is a walled organization owner granted `manage_metadata` inside its own organization. It keeps history, audit and diff, and loses commits.

Who is still admitted:

- History, audit and diff admit a system caller, `studio.access` or `manage_metadata`, through their own predicate.
- The commits door admits a system caller or `studio.access`.
- Both capabilities are platform-scoped. Platform operators are not affected, and neither are metadata authors who hold `studio.access` (all four doors) or `manage_metadata` (history, audit and diff; commits never admitted it).

Unchanged:

- The draft switches keep their admission, `setup.access` included: `GET /meta/_drafts`, `?state=draft` and `?preview=draft`.
- `GET /packages`, `GET /packages/:id` and `GET /packages/:id/export` keep their read cohort (`studio.access` or `setup.access`).
- The refusal keeps its envelope and code at each door. Only the message changes: it now names the capabilities that admit the door.

What changes for you. If an organization admin needs a metadata item's history, audit trail or package commits, grant `studio.access`. A `manage_metadata` holder without `studio.access` who read package commits through `setup.access` needs `studio.access` for them too. A client that offers History or Audit to a caller holding only `setup.access` should hide them for that caller. The Setup app's item editors do this in objectstack-ai/objectui#12475.

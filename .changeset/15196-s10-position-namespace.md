---
'@objectstack/plugin-security': minor
---

feat(plugin-security)!: under `single`, a Setup create of a position, or a rename into a name, that a package or a built-in already holds is refused with the metadata door's own refusal (ADR-0048 addendum N.2/N.3)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export, type or stored shape is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is a runtime write door: under the single posture, a sys_position create, or a rename into a name, that a package or a built-in holds is now refused at the data door, as the metadata door already refuses the same name, and the remedy is a different data value (the position's name), not a rewrite of anyone's code or metadata. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no TypeScript declaration moves (not runtime-interface-only or type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

Positions hold one name per deployment (ADR-0048 addendum, N.2). A position a package declares, and the platform's built-in positions, are managed items: the metadata door already refused an environment save under their names (`PUT /api/v1/meta/position/:name` answers `403 NOT_OVERRIDABLE`). The Setup data door did not.

**FROM.** Under `single`, a non-system `POST /api/v1/data/sys_position` whose `name` a package or a built-in holds answered `201`. The new row sat beside the package's (or the platform's) position under the same name. A `PATCH` that renamed an administrator's position into such a name answered `200`, and it also deleted that position's own environment definition. Measured on the showcase: a create of `manager` (package-declared), `everyone` or `guest` (built-in audience anchors) answered `201`, and a rename into `exec` answered `200`.

**TO.** Under `single`, the same create, or a rename into such a name, is refused with the metadata door's own refusal, relayed as the door builds it: `403 NOT_OVERRIDABLE`. No row is kept, a renamed row keeps its old name, and its definition is untouched. The door's own verdict is asked; nothing is written to environment metadata for such a name.

- **Unchanged.** The engine's own refusals answer first, as before: a reserved built-in identity name (`platform_admin`, `org_owner`, `org_admin`, `org_member`) stays `400 VALIDATION_FAILED`, and a name already held in the same organization stays `409 UNIQUE_VIOLATION`. An edit that keeps such a name, and a delete, behave as before. System writes, walled postures and kernels without a metadata door behave as before. Under a walled posture, each organization already holds its own rows of the declared and built-in names, so the same create answers `409 UNIQUE_VIOLATION`, as before.
- **Remedy.** Rename the position: give it a name no package and no built-in holds (for example `regional_manager` instead of `manager`), then point any assignment at the new name. `GET /api/v1/meta/position` lists the names already held.

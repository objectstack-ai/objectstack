---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: a package-less action save on an object no package binds the name to writes the environment's own action

Clause-②: yes (narrowing)
Metadata-protocol: semantic
Skills-docs: none — no skill under `skills/**` teaches where a package-less save of a writable package's item is written; `skills/objectstack-platform` teaches only the managed base's `.custom` pair, whose refusals do not move.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped. The moved answer is which stored row a package-less save of an action writes; a row an older build re-addressed into a package stays as it was stored, so there is nothing for a migration to rewrite. -->

**BREAKING** (ADR-0150 D4, maintainer ruling 6902014292): an action is keyed `(package, objectName, name)`. A package-less `PUT /api/v1/meta/action/NAME` (no `?package=`) whose body binds an object that no package holding the name binds it to now writes the environment's own action on that object. Every package's action of that name stays where it is.

FROM → TO, writable package `P` holding `approve` on `invoice`:

- package-less save of `approve` bound to `task`: FROM written into `P` (receipt `package=P`), moving `P`'s action from `invoice` to `task` · TO the environment's own row on `task` (receipt with no package); `P`'s action on `invoice` is untouched, `GET /meta/action/approve?package=P` still serves it, and `/actions/invoice/approve` still runs it.
- the same save object-less: the same move · TO the environment's own object-less row.
- two packages holding `approve` on two other objects: FROM `409 RESOURCE_CONFLICT` naming both · TO the environment's own row.

Unchanged: the same save on `invoice` (the object `P` binds) is still `P`'s customization; a package on `invoice` and another on `task` still answer a save on `task` with `409` naming both; a managed (code) package's action name is still refused `403 NOT_OVERRIDABLE`; every type other than `action`; a draft save (`?mode=draft`) still inherits the package of the item's active rows.

What to do: to move a package's own action to another object, save it naming the package (`?package=P`). A row an older build moved into a package is not moved back; save it again naming the package with its original object to restore it.

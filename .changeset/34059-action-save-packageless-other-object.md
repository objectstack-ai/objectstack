---
'@objectstack/metadata-protocol': minor
'@objectstack/spec': patch
---

fix(metadata-protocol)!: a package-less action save on an object no package binds the name to writes the environment's own action

Clause-②: yes (narrowing)
Metadata-protocol: semantic
Skills-docs: none — no skill under `skills/**` teaches where a package-less save of a writable package's item is written; `skills/objectstack-platform` teaches only the managed base's `.custom` pair, whose refusals do not move.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped. The moved answer is which stored row a package-less save of an action writes; a row an older build re-addressed into a package stays as it was stored, so there is nothing for a migration to rewrite. -->

**BREAKING** (ADR-0150 D4, maintainer ruling 6902014292): an action is keyed `(package, objectName, name)`. A package-less `PUT /api/v1/meta/action/NAME` (no `?package=`) whose body binds an object that no package holding the name binds it to now writes the environment's own action on that object. Every package's action of that name stays where it is.

The moved answers, for a writable package `P` holding `approve` on `invoice`:

- a package-less save of `approve` bound to `task` was written into `P` (receipt `package=P`) and moved `P`'s action from `invoice` to `task`; it now writes the environment's own row on `task` (a receipt with no package), and `P`'s action on `invoice` is untouched: `GET /meta/action/approve?package=P` still serves it and `/actions/invoice/approve` still runs it.
- the same save with an object-less body: it now writes the environment's own object-less row.
- with two packages holding `approve` on two other objects, the save was refused `409 RESOURCE_CONFLICT` naming both; it now writes the environment's own row.
- with `P` the sole holder and `P` disabled, the save was written into `P`'s row; it now writes the environment's own row on `task`.
- with the sole row on `invoice` bound to a package that is not installed, the save was refused `422`; it now writes the environment's own row on `task`.
- with `P` on `invoice` and `Q` on `product`, a draft save bound to `task` was refused `409` naming both; it now writes the environment's own draft, the per-item publish naming no package promotes it into the environment's own row, and the draft discard naming no package removes it (each was `409` naming both).
- with `P` (enabled) on `invoice` and a disabled package `Q` on `task`, the save on `task` was written into `P` and moved its action to `task`; it is now judged over the holders on `task` only, so it writes `Q`'s row (as a save over a name only a disabled package holds does), and `P`'s action on `invoice` is untouched.
- with `P` (enabled) on `invoice`, and on `task` an enabled `Q` and a disabled `R`, the save on `task` was refused `409` naming `P` and `Q`; it is now judged over the holders on `task` only, so it writes `Q`'s row, and `P`'s action on `invoice` is untouched. Without `R` the same save is still refused `409` naming `P` and `Q` (below).
- a draft save (`PUT …?mode=draft`) of `approve` bound to `task` was written as `P`'s draft (receipt `package=P`), and the per-item publish naming no package (`POST /meta/action/approve/publish`) promoted it over `P`'s action on `invoice`; the draft is now the environment's own draft (a receipt with no package), and its publish writes the environment's own row on `task`. Beside a sole binding to a package that is not installed, the draft save was refused `422`; it now writes the environment's own draft, and its publish the environment's own row.
- with the environment's draft on `task` stored, a package-less draft save on `invoice` adopted that draft into `P` and rewrote it on `invoice`, so the environment's pending draft was gone; it now writes `P`'s draft on `invoice` and the environment's draft on `task` stays.

Unchanged: the same save or draft save on `invoice` (the object `P` binds) is still `P`'s customization, and its publish is `P`'s row; a package on `invoice` and another on `task`, both enabled, still answer a save on `task` with `409` naming both; a managed (code) package's action name is still refused `403 NOT_OVERRIDABLE`; every type other than `action`.

The two modes still differ for one enabled and one disabled holder with the body on the disabled holder's object: the publish-mode save writes the disabled holder's row, while the draft save is refused `409` naming both, as it was.

Not moved yet (#33904, the read, list and delete half): the environment's row on `task` has no by-name read, since `GET /meta/action/approve` naming no package still serves `P`'s action; it is not in `GET /meta/action`; and a package-less `DELETE /meta/action/approve` removes `P`'s row on `invoice`, not the environment's. The version the bare read serves is `P`'s, so a save on `task` that carries it as its parent (`If-Match`) is refused as a version conflict, before and after the environment's row exists; send the save without `If-Match`. The one address that reaches the environment's row today is the action route `/actions/_env/task/approve`; a read or delete naming `P` (`?package=P`) reaches `P`'s.

Until #33904 lands, no meta address deletes only the environment's own action: do not send a package-less delete of the name to remove it, because that removes the package's action. A package's own action is moved to another object by a save naming the package (`?package=P`), as before. A package's action that an older build moved to another object stays where it was stored.

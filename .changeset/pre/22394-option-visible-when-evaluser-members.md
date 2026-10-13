---
"@objectstack/lint": minor
"@objectstack/metadata-protocol": minor
---

fix(lint)!: `os build` and the object save door refuse a select option's `visibleWhen` that reads a member of the acting user the server's option check never binds, such as `current_user.roles` (renamed `positions`), `ctx.user.roles` or `current_user.email` (#22394)

Clause-②: no (narrowing: a select option's `visibleWhen` that reads an `EvalUser` member the schema does not declare is refused at build and at the object save door)

A select option's `visibleWhen` is a gate the server enforces on write. The option check binds the acting user under four spellings, `current_user` and its ADR-0068 aliases `user`, `ctx.user` and `os.user`, all one `EvalUser` object. That object carries the caller's `id`, `positions`, `isPlatformAdmin` and `organizationId`, and nothing else. The build already refused a root the option check does not bind (such as `parent`) and a member of `ctx` or `os` other than `user`, but it stopped there. So an option predicate that read `'admin' in current_user.roles`, `ctx.user.roles == ['a']` or `current_user.email == 'a@b.c'` passed `os build` and the object save door with no finding. `roles` has not been a member of the acting user since ADR-0090 D3 renamed it `positions`; `name` and `email` are declared by `EvalUserSchema` but the server never sets them for this check. On every write that picked the option the predicate then faulted (`No such key: roles`, `email`), the server logged "the option's gate was NOT enforced on this write", and the value was admitted.

The build's expression rule (`validateStackExpressions`) now judges the members of the acting user in an option's `visibleWhen`, under all four spellings, in the same verdict that judges its roots and the members of `ctx` and `os`. A member is accepted only when `EvalUserSchema` (`@objectstack/spec`) declares it AND the option check binds it; the allowlist is read off the schema and off `@objectstack/formula`'s `buildScope`, never written out. Any other member is refused at `error` and located at the option (`object 'NAME' · field 'FIELD' option 'VALUE' visibleWhen`). The message names the member, names the members the acting user does carry there, and gives the remedy. Every spelling of the read is judged the same: `current_user.roles`, `current_user.?roles`, `current_user['roles']`, `has(current_user.roles)`, and the same below `ctx.user` and `os.user`. The object save door runs the same pass, so its verdict is the build's finding: the same rule id (`expression-invalid`), location, message and hint.

**BREAKING — what moves for consumers.**

- `os build`, `os validate` and `os lint` refuse an option `visibleWhen` that reads a member of `current_user`, `user`, `ctx.user` or `os.user` other than `id`, `positions`, `isPlatformAdmin` and `organizationId`, such as `current_user.roles`, `current_user.role`, `ctx.user.roles`, `current_user.email` or `user.name`.
- An object write in publish mode that carries such an option answered 200. It now answers `422 INVALID_METADATA`, with an `expression-invalid` issue located at that option. This covers `PUT /api/v1/meta/object/:name` (and `saveMetaItem` in publish mode), the promotion of a draft (`POST /api/v1/meta/object/:name/publish`, `publishMetaItem`), and a package draft publish (`publishPackageDrafts`).

**Remedy.**

- `roles` / `role` → `positions`: `'admin' in current_user.roles` becomes `'admin' in current_user.positions`, in whichever spelling the predicate used (`ctx.user.roles` becomes `ctx.user.positions`).
- `name`, `email` and any other member: rewrite the predicate against a member the option check binds (`current_user.id`, `current_user.positions`, `current_user.isPlatformAdmin`, `current_user.organizationId`), or against a column the object declares (`record.FIELD`, `previous.FIELD`).
- Saving the object as a draft (`mode: 'draft'`) is still allowed, because drafts are never gated; publishing that draft is judged.

**Unchanged.**

- The server's option check is unchanged. It binds what it bound before, and an option predicate that faults is still logged and admitted. If the runtime comes to bind a member such as `email` for an option, this refusal lifts for that member in the same change, because the allowlist is derived from what the option check binds.
- The same members are still accepted where they are bound, such as `current_user.email` in a row-level security policy or an object action's `visible` predicate. The refusal is the option slot's alone.
- A grant check such as `current_user.can('OBJECT', 'edit')` is a call, not a member read, and is still accepted.
- A computed key such as `current_user[name]` names no member, so it is not judged.
- Stored rows are not migrated, and they are not refused on read. An object stored before this change keeps loading until it is next saved, and that save is judged.
- `OS_ALLOW_UNLINTED_METADATA_WRITES=1` still turns a refusal into a logged write.
- Measured before crossing: the objects this repository ships carry 5 option predicates, all on `showcase_cascade`, which read `record` (four) and `current_user` (one, `current_user.positions`). None reads a member the option check does not bind. That holds over every object in its `*.object.ts` files and the two `app-multi-package` sub-stacks. They have 0 refusals at the build, before this change and after it.
- No public export or signature moves. `validateStackExpressions(stack)` keeps its signature, and no registry entry changes.

<!-- adr-0087: not-required (no-migration-prescription) a refusal at `os build` and at the object save door of a select option's visibleWhen predicate that reads a member of the acting user the server's option check does not bind: no authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted. A stored object whose option predicate is refused keeps loading until it is next saved, and the repair is the author's rewrite of the predicate against what the option check binds, which no ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this verdict (not already-registered); and the change is a build and door verdict, not a declaration (not runtime-interface-only or type-surface-only). -->

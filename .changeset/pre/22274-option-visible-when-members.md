---
"@objectstack/lint": minor
"@objectstack/metadata-protocol": minor
---

fix(lint)!: `os build` and the object save door refuse a select option's `visibleWhen` that reads a member of `ctx` or `os` the server's option check never binds, such as `os.org.id`, `os.env` or `ctx.locale` (#22274)

Clause-②: no (narrowing: a select option's `visibleWhen` that reads an unbound member of a bound root is refused at build and at the object save door)

A select option's `visibleWhen` is a gate the server enforces on write. The option check binds `record`, `previous` and the acting user, as `current_user` and its ADR-0068 aliases `user`, `ctx.user` and `os.user`. Under `ctx` and `os` it binds the `user` member and nothing else: it passes no organization and no environment. The build already refused a root the option check does not bind, such as `parent`, but it judged `ctx` and `os` as whole roots. So an option predicate that read `os.org.id != ''`, `os.env == 'prod'` or `ctx.locale == 'en'` passed `os build` and the object save door with no finding. On every write that picked the option the predicate then faulted (`No such key: org`, `env` or `locale`), the server logged "the option's gate was NOT enforced on this write", and the value was admitted.

The build's expression rule (`validateStackExpressions`) now judges the members of `ctx` and `os` in an option's `visibleWhen`, in the same verdict that judges its roots. A member other than `user` is refused at `error` and located at the option (`object 'NAME' · field 'FIELD' option 'VALUE' visibleWhen`). The message names the member, says that the option check binds only the `user` member under that root, and gives the remedy. Every spelling of the read is judged the same: `os.org`, `os.?org`, `os['org']` and `has(os.org)`. The object save door runs the same pass, so its verdict is the build's finding: the same rule id (`expression-invalid`), location, message and hint.

**BREAKING — what moves for consumers.**

- `os build`, `os validate` and `os lint` refuse an option `visibleWhen` that reads a member of `ctx` or `os` other than `user`, such as `os.org.id`, `os.org.tier`, `os.env` or `ctx.locale`.
- An object write in publish mode that carries such an option answered 200. It now answers `422 INVALID_METADATA`, with an `expression-invalid` issue located at that option. This covers `PUT /api/v1/meta/object/:name` (and `saveMetaItem` in publish mode), the promotion of a draft (`POST /api/v1/meta/object/:name/publish`, `publishMetaItem`), and a package draft publish (`publishPackageDrafts`).

**Remedy.**

- For the caller's organization, compare `current_user.organizationId`, which the option check does bind: it holds the acting user's organization id, or `null` when the caller acts outside an organization. `os.org.id != ''` becomes `current_user.organizationId != null`. No other organization fact, such as its tier, is available to an option predicate; read a column the object declares instead.
- `os.env`, `ctx.locale` and any other member: rewrite the predicate against `record.FIELD`, `previous.FIELD`, or the acting user as `current_user`.
- Saving the object as a draft (`mode: 'draft'`) is still allowed, because drafts are never gated; publishing that draft is judged.

**Unchanged.**

- The server's option check is unchanged. It binds what it bound before, and an option predicate that faults is still logged and admitted. If the runtime comes to bind a member such as `os.org` for an option, this refusal is lifted for that member in the same change.
- The acting user is still accepted under all four ADR-0068 spellings (`current_user`, `user`, `ctx.user`, `os.user`), and so are its fields (`current_user.positions`, `ctx.user.id`) and a grant check such as `current_user.can('OBJECT', 'edit')`.
- The same members are still accepted where they are bound, such as `os.org.id` in a `formula` field's `expression`. The refusal is the option slot's alone.
- A computed key such as `os[name]` names no member, so it is not judged.
- Stored rows are not migrated, and they are not refused on read. An object stored before this change keeps loading until it is next saved, and that save is judged.
- `OS_ALLOW_UNLINTED_METADATA_WRITES=1` still turns a refusal into a logged write.
- Measured before crossing: the objects this repository ships carry 5 option predicates, all on `showcase_cascade`, which read `record` (four) and `current_user` (one). None reads `ctx` or `os`. That holds over every object in its `*.object.ts` files and the two `app-multi-package` sub-stacks, and over the example stacks as `defineStack` composes them. They have 0 refusals at the build and at the door, before this change and after it.
- No public export or signature moves. `validateStackExpressions(stack)` keeps its signature, and no registry entry changes.

<!-- adr-0087: not-required (no-migration-prescription) a refusal at `os build` and at the object save door of a select option's visibleWhen predicate that reads a member of ctx or os the server's option check does not bind: no authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted. A stored object whose option predicate is refused keeps loading until it is next saved, and the repair is the author's rewrite of the predicate against what the option check binds, which no ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this verdict (not already-registered); and the change is a build and door verdict, not a declaration (not runtime-interface-only or type-surface-only). -->

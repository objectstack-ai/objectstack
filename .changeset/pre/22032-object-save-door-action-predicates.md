---
"@objectstack/lint": minor
"@objectstack/metadata-protocol": minor
---

fix(lint)!: the object save door refuses an object action's `visible` or `disabled` predicate that `os build` refuses (#22032)

Clause-②: no (narrowing: the object save door refuses an action visible or disabled predicate os build already refuses)

`formulas.mdx` says the same `validateExpression` validator backs `os build` and metadata registration. For an object's own actions it did not, at the object save door. An action whose `visible` read a bare field, such as `amount > 1`, or called an unregistered function, such as `sqrt(record.amount) > 1`, was refused by `os build` at error, but `PUT /api/v1/meta/object/:name` answered 200 and stored it. The action runtime evaluates such a predicate fail-closed, so the action was hidden on every record.

The runtime publish gate now runs the build's action check on an object write. The build's expression rule (`validateStackExpressions`) was already on the object door for formula fields, validation-rule predicates, the field-rule slots and option `visibleWhen`. On an object write it now also judges each `actions[].visible`, and each `actions[].disabled` that is not a boolean literal, as a predicate over `record`, the way the build does. Every expression an object carries is now judged at this door. The door's verdict is the build's finding: the same rule id (`expression-invalid`), location (`object 'NAME' · action 'ACTION' visible`, or `disabled`), message and hint. One location differs, never the verdict: an action that is also declared in the stack's top-level `actions` is located by `os build` at `stack · action 'ACTION' visible`, and by the door, which judges the object alone, at the object.

**BREAKING — what moves for consumers.**

- An object write in publish mode answered 200 for an action whose `visible` or `disabled` the shared validator refuses. It now answers `422 INVALID_METADATA`, with an `expression-invalid` issue located at that action. This covers `PUT /api/v1/meta/object/:name` (and `saveMetaItem` in publish mode), the promotion of a draft (`POST /api/v1/meta/object/:name/publish`, `publishMetaItem`), and a package draft publish (`publishPackageDrafts`).
- The verdict is the one `os build`, `os validate` and `os lint` already gave: an unknown function, a field the object does not declare, a bare field reference (`amount` instead of `record.amount`), and a syntax error. Its warnings now ride the save response as advisories.
- The platform's own `sys_approval_request` (shipped by `@objectstack/plugin-approvals`) carries 8 action `visible` predicates that read `record.viewer`, a block the approvals service attaches on read and the object does not declare. The shared validator refuses all 8 (``unknown field `viewer` on `sys_approval_request` ``). Until #22211 lands, a save of that packaged object answers as follows. The first two rows were measured on the showcase's `objectstack dev` boot; the third is a source reading.

  | kernel and setting | publish save, before → after | draft save |
  |:--|:--|:--|
  | host-config kernel, no `OS_METADATA_WRITABLE` | 403 `NOT_OVERRIDABLE` → 422 `INVALID_METADATA` (8 issues) | 403 `NOT_OVERRIDABLE` |
  | `OS_METADATA_WRITABLE=object` | 200 → 422 `INVALID_METADATA` (8 issues) | 200 |
  | environment-scoped kernel | 403 `NOT_OVERRIDABLE`, unchanged | 403 `NOT_OVERRIDABLE` |

  On a host-config kernel the authoring gate answers before the package door, so there the 422 is returned where the more basic 403 belongs; #22220 carries that order. The object itself is unchanged: it registers, is served, and its actions evaluate as before.

**Remedy.** Fix the predicate: the message names the unknown function or field, the bare reference, and the position, as `os build` already requires. Qualify field reads as `record.FIELD`, use one of the functions `introspectScope` lists, and write a boolean literal (`true` / `false`) for a constant. Saving the object as a draft (`mode: 'draft'`) is still allowed, because drafts are never gated; publishing that draft is judged. For `sys_approval_request` there is nothing to repair on the consumer side: its predicates are the platform's, and #22211 carries the fix.

**Unchanged.**

- Stored rows are not migrated, and they are not refused on read. An object stored before this change keeps loading until it is next saved, and that save is judged.
- The stack's top-level `actions`, its flows, its sharing rules and its hooks are not judged on an object write: each is judged at its own type's door, as before.
- `OS_ALLOW_UNLINTED_METADATA_WRITES=1` still turns a refusal into a logged write.
- Measured before crossing: every object this repository ships (118 objects from its `*.object.ts` files) carries 58 action predicates on 16 objects, and the example stacks as `defineStack` composes them (33 objects, standalone actions merged in) carry 59 on 5. The shared validator refuses the 8 on `sys_approval_request` above and nothing else, and the door refuses the same 8 after this change and none before it. There are 0 other refusals and 0 advisories, at both doors.
- No public export or signature moves. `validateStackExpressions(stack)` keeps its signature, and no registry entry changes: the expression rule already declared `object`. The built entry declarations differ only in one doc comment, on `AuthoringRuleContext.runtimeWriteType`.

<!-- adr-0087: not-required (no-migration-prescription) a refusal at the object save door of an object action's visible or disabled predicate the published validator already refuses at `os build`: no authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted. A stored object whose action predicate the validator refuses keeps loading until it is next saved, and the repair is the author's edit of the predicate, which no ledger entry can derive. The other categories are closed on facts: the packages publish (not unpublished); no ADR-0087 id covers this door (not already-registered); and the change is a door verdict, not a declaration (not runtime-interface-only or type-surface-only). -->

---
'@objectstack/objectql': minor
---

fix(objectql): a `formula` field and a CEL `defaultValue` answer `current_user.can(object, verb)` from the security service (#20082)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) no authored key, stored shape, export or route changes; the narrowing is a runtime refusal when the permission resolution fails, and there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING**, for one fault path only, shipped as `minor` under the launch-window convention (`check-changeset-no-major` refuses `major` until GA, so this banner and the ADR-0087 disposition above carry the breaking-ness). An insert row whose CEL `defaultValue` calls `current_user.can(…)` is now refused with the resolution's own error when the registered security service fails to resolve the caller's effective object permissions. Before, that default was left unset with a `warn` and the row was written.

`@objectstack/formula` answers `can` from `EvalContext.permissions`, and neither engine site passed one. With the security plugin registered:

- a formula field calling `current_user.can(…)` read `null` on every `find`, `findOne` and write response, and logged nothing;
- a CEL `defaultValue` calling it was left unset with the `warn` "Failed to evaluate default expression". A `required` field defaulted that way therefore refused every insert.

**What changes.** Both sites now evaluate with the acting subject's effective object permissions. That is the map `ISecurityService.getEffectiveObjectPermissions` returns, which an option's `visibleWhen` already reads.

- A formula field reads `true` or `false`.
- A CEL default stores `true` or `false`, so a `required` field defaulted by `can` is admitted.

The engine asks the security service at most once per operation: once per `find` (not per row), and once per write, shared by its defaults, its `can`-gated options and the formula fields on its response. It asks only when a formula, or a default that will be applied, calls `can`, and only when the operation has an acting user. The answer is never kept past the operation.

**When there is no map.**

- No security service is registered. No permission data is passed, as before. A formula field still reads `null`, and each operation now logs one `warn` naming the object, the fields and `reason: 'no-permission-source'`. A default is still left unset with its existing `warn`.
- The resolution fails: it throws, or it returns a map that is not the published shape. A formula field reads `null`, and one `warn` carries the error with `reason: 'permission-resolution-failed'`, because a read is not refused over one computed field. An insert row whose `can` default needed the map is refused with the resolution's own error. Under `insertMany` only that row is refused, and the `validate()` preview rejects the same way. Rows that supply the field, and objects whose defaults never call `can`, are unaffected.

In no case is `can()` answered `true` without a grant, or `false` from an empty map.

`evaluateFormulaField` (and `resolveRecordTitle`, which uses it) is synchronous and passes no map, so a formula calling `can` still yields `null` there.

No spec key, export or route is added or removed.

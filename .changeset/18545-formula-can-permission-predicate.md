---
'@objectstack/formula': minor
---

Add `current_user.can(object, verb)` — the permission predicate — to the CEL engine, together with the data it is answered from.

`Clause-②: yes` — a new callable name widens the authorable surface. Purely additive: nothing is removed, renamed or narrowed, and every expression that evaluated before evaluates the same way.

**What you can write now**

```cel
current_user.can('crm_lead', 'edit')
```

`can` is registered **receiver-only**, so it is called ON the acting subject (`current_user`, or its `user` / `ctx.user` / `os.user` aliases — the same object). A bare `can(object, verb)` is deliberately not registered and keeps faulting: a permission question with no subject has no meaning.

The verb vocabulary is the closed table `OBJECT_PERMISSION_VERBS` in `@objectstack/spec/security` — `read`, `create`, `edit`/`update`/`write`, `delete`/`remove`, `export`, `transfer`, `import`. A verb outside it is refused loudly rather than answered `false`. The answer folds the super-user bits exactly as the enforcement door does, so a predicate and the server's 403 cannot disagree.

**What a call site must pass**

`EvalContext` gains `permissions` — a pure data map, object name → `EffectiveObjectPermission`, which is the `objects` map of the published `/auth/me/permissions` response, unchanged. Build it through the new `toEvalPermissions(response.objects)`, which refuses a payload that is not that shape.

```ts
import { toEvalPermissions } from '@objectstack/formula';

const permissions = toEvalPermissions(mePermissions.objects);
ExpressionEngine.evaluate(predicate, { user, record, permissions });
```

**With no permission data in the context, `can` THROWS** (`ok: false`, `kind: 'runtime'`) and names the missing input. It never answers `true` (which would reveal what the subject may not see) and never answers a silent `false` (which would hide a gated element from everyone, indistinguishable from a real denial). An *empty* map is a real answer and evaluates to `false`, as does an object the map does not mention.

**Also new, all additive**: `EvalPermissions` and `PermissionBinding` types, `registerPermissionPredicate()`, and an optional fourth argument on `registerStdLib()` carrying the binding. Existing three-argument calls are unaffected.

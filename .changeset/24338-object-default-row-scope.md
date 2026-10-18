---
'@objectstack/spec': minor
---

feat(spec): an object can declare its default row scope, `defaultRowScope`, the row-level security policy shape without `object`

Clause-②: yes (widening)

`ObjectSchema` gains one optional key, `defaultRowScope`: one row-level security policy, written like a permission set's `rowLevelSecurity` entry without `object`, which the declaring object implies. The shape is exported as `DefaultRowScopeSchema` from `@objectstack/spec/security` (types `DefaultRowScope` and `DefaultRowScopeParsed`).

- **What it parses.** Every member of `RowLevelSecurityPolicySchema` except `object`, the same member schemas: `name`, `label`, `description`, `operation`, `using`, `check`, `positions` and `enabled` (default `true`). The policy's two rules hold as written: at least one of `using` / `check`, and no `check` on a `select` or `delete` policy.
- **What it refuses.** `object` is refused by name, with a prescription to delete it: the target is implied. Any other unknown key is refused too, the policy's retired `priority` and `tags` included.
- **What it does today: nothing.** No server reads the key in this release, so declaring it filters no rows. The describe states the contract the security plugin's row-policy collection is to meet once it reads the key: the default is to apply when no permission set the caller holds carries a row policy for the object; a policy an authored set carries is to be used as authored; a superuser-bypass principal is to be unaffected; an object without the key keeps its behaviour. No object declares the key yet; the platform's identity objects are to declare it for their own tables. Authoring the key raises the liveness lint's `liveness-planned-property` warning until then. Restrict rows with a permission set's `rowLevelSecurity` policy in the meantime.
- **`composeStacks` with `objectConflict: 'merge'`** now refuses two stacks that declare a different `defaultRowScope` on the same object, the way it refuses every other fixed-shape config object (`access`, `enable`, `publicSharing`, …). The refusal message's list of those objects names `defaultRowScope` too. Nothing composed before is affected, because no stack declared the key.
- Additive: every object that parsed before still parses, and its parsed output is unchanged.

---
'@objectstack/spec': minor
'@objectstack/metadata-core': patch
---

feat(spec): an object can declare its default row scope, `defaultRowScope`, the row-level security policy shape without `object`

Clause-②: yes (widening)

`ObjectSchema` gains one optional key, `defaultRowScope`: one row-level security policy, written like a permission set's `rowLevelSecurity` entry without `object`, which the declaring object implies. The shape is exported as `DefaultRowScopeSchema` from `@objectstack/spec/security` (types `DefaultRowScope` and `DefaultRowScopeParsed`).

- **What it parses.** Every member of `RowLevelSecurityPolicySchema` except `object`, the same member schemas: `name`, `label`, `description`, `operation`, `using`, `check`, `positions` and `enabled` (default `true`). The policy's two rules hold as written: at least one of `using` / `check`, and no `check` on a `select` or `delete` policy.
- **What it refuses.** `object` is refused by name, with a prescription to delete it: the target is implied. Any other unknown key is refused too, the policy's retired `priority` and `tags` included.
- **What it does.** The security plugin's row-policy collection (`collectRLSPolicies`), the one step every read, write and explain passes through, applies the key: when the permission sets the caller holds carry no row policy for the object and the operation (a `'*'` policy counts; one switched off, outside the caller's positions, or for another operation does not), the object's default is used in their place and judged like a held policy. A policy an authored set carries for the object is used as authored, with the default not added to it; a principal whose superuser bypass skips row policies is unaffected; an object without the key keeps its behaviour. A `using` the row-filter compiler cannot lower makes the reads it governs return no rows, with one server warning. The platform's identity objects are to declare it for their own tables in a separate change. See the `@objectstack/plugin-security` entry in this release for the reader.
- **`composeStacks` with `objectConflict: 'merge'`** now refuses two stacks that declare a different `defaultRowScope` on the same object, the way it refuses every other fixed-shape config object (`access`, `enable`, `publicSharing`, …). The refusal message's list of those objects names `defaultRowScope` too. Nothing composed before is affected, because no stack declared the key.
- **`@objectstack/metadata-core`: the field-level-security projection classifies the new key.** When an object document is served to a caller who cannot read some of its fields, `defaultRowScope` is treated like a validation rule: the whole policy is dropped from the served document when its `using`, `check` or prose names a field that caller cannot read, and served unchanged otherwise. No behaviour moves until an object declares the key, and no object declares it yet.
- Additive: every object that parsed before still parses, and its parsed output is unchanged.

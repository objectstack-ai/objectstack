---
'@objectstack/plugin-security': patch
---

fix(plugin-security): `security/explain` answers the read's `INVALID_FILTER` / 400 for a row-level policy that aims an operator the read refuses at a field declared JSON-stored, instead of a "visible" verdict for a request enforcement refuses (#21319)

Clause-②: no

The read a row-level policy scopes refuses a scalar comparison, an ordering or a text operator (`@objectstack/core`'s `JSON_COLUMN_INCOMPATIBLE_OPERATORS`, and implicit equality) on a field the object declares JSON-stored: a structured-JSON type (`json`, `address`, …), or a multi-valued field (`tags`, `multiselect`, `checkboxes`, or a `select` / `radio` / `lookup` / `user` / `file` / `image` flagged `multiple: true`). The row-level write `check` refuses them too, by the same rule. `security/explain` (the `security` service's `explain()` and `POST /api/v1/security/explain`) evaluated them in JS instead. Measured with `SecurityPlugin` on two SQLite driver families, as a member resolving a permission set whose `using` is the predicate:

| `using` | find | explain, before |
|---|---|---|
| `record.tags != 'x'` (`tags` is `tags`, multi-valued) | 400 | `visible: true`, decided by `rls` |
| `record.meta == 'x'` (`meta` is `json`) | 400 | `visible: true`, decided by `rls` |
| `!(record.tags in ['x'])` | 400 | `visible: true`, decided by `rls` |
| `record.owners != 'x'` (a `select` or `lookup` flagged `multiple`) | 400 | `visible: true`, decided by `rls` |

The report without a record id said `allowed: true`, and a record id no row carries was reported `visible: false`. Now explain answers every one of these with the read's refusal, `INVALID_FILTER` / 400 and no verdict, for every operation, the answer it already gives a policy comparing two fields of different classes; a by-id update or delete is itself refused 403, at the row-level gate whose pre-image re-read is the refused read. The message leads with the full diagnostic, which names the field and the operator and says how to repair the policy, then the policy that carries it; the error's `cause` carries the read's refusal, with the find's code, status and message. The rule is the one the write check applies, and it reads the object's declaration, never the record.

Unchanged: `contains` and its negation (`$contains` / `$notContains`), and the presence checks (`== null`, `!= null`), answer on such a field as before; a field declared neither way keeps every operator; an object whose schema cannot be loaded is judged as before. To repair a refused policy, test membership with `contains` (for example `!record.tags.contains('x')`).

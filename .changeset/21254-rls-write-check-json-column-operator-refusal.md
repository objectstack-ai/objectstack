---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a row-level `check` refuses an operator the read refuses on a field declared JSON-stored, with the read's `INVALID_FILTER` / 400, so a policy whose read is refused no longer admits writes (#21254)

Clause-②: no

The read a row-level policy scopes refuses a scalar comparison, an ordering or a text operator (`@objectstack/core`'s `JSON_COLUMN_INCOMPATIBLE_OPERATORS`, and implicit equality) on a field the object declares JSON-stored: a structured-JSON type (`json`, `address`, …), or a multi-valued field (`tags`, `multiselect`, `checkboxes`, or a `select` / `lookup` / `user` / `file` / `image` flagged `multiple: true`). The write `check` evaluated the same operators against the stored list instead. Measured through `ObjectQL.insert` with `SecurityPlugin` on two SQLite driver families, as a member resolving a permission set, with the same predicate as `using` and `check`:

| `check` | written | write, before | read |
|---|---|---|---|
| `record.tags != 'x'` | `['x']` or `'x'` | admitted, stored `["x"]` | 400 |
| `!(record.tags in ['x'])` | `['x']` | admitted, stored `["x"]` | 400 |
| `record.tags == 'x'` / `record.tags in ['x']` | `['x']` | 403 | 400 |
| `record.tags > 'a'` | `['x']` | 400 | 400 |
| `record.meta != 'x'` / `record.meta == 'x'` (`meta` is `json`) | a scalar | admitted, stored | 400 |

Now the write check refuses every one of these with the read's answer: `INVALID_FILTER` / 400 and the read's words, which withhold the field and the operator. The refusal reads the object's declaration, never the record, so a policy is refused for every row or for none, on the insert, a by-id update and a predicate update. The diagnostic, which names the field, the operator and the policy, goes to the server log. Rows that already refused still store nothing; their answer is now the read's.

Unchanged: `contains` and its negation (`$contains` / `$notContains`), and the presence checks (`== null`, `!= null`), answer on such a field as before; a field declared neither way keeps every operator; an object whose schema cannot be loaded is judged as before. To repair a refused policy, test membership with `contains` (for example `!record.tags.contains('x')`).

---
'@objectstack/core': minor
'@objectstack/objectql': patch
'@objectstack/plugin-security': minor
---

fix(plugin-security): a row-level `check` judges a lone scalar written to a declared multi-valued field as the one-member list it is stored as, so the write and the read the same policy scopes give one answer for one row (#21238)

Clause-②: yes (widening)

The write door stores a lone scalar sent to a multi-valued field (`tags`, `multiselect`, `checkboxes`, or a `select` / `lookup` / `user` / `file` / `image` flagged `multiple: true`) as a one-member list: `tags: 'x'` is stored as `["x"]`. The row-level write `check` judged the value as sent on the insert and on a by-id update, because both images are formed before the write door runs. Measured through `ObjectQL.insert` with `SecurityPlugin` on two SQLite driver families, as a member resolving a permission set, with the same predicate as `using` and `check`:

| `check` | written | write, before | stored | read |
|---|---|---|---|---|
| `record.tags.contains('x')` | `'x'` | 403 | `["x"]` | shown |
| `!record.tags.contains('x')` | `'x'` | admitted | `["x"]` | hidden |
| `record.tags.contains('x')`, a by-id update | `'x'` | 403 | `["x"]` | shown |

Now the image's value on every field the object declares multi-valued goes through the same rule the write door stores it by, before the check is judged. The first and third rows are admitted. The second is refused: a policy that forbids a member from tagging a row `x` can no longer be passed by sending `'x'` instead of `['x']`. A lone scalar now gets exactly the verdict its stored list gets, on the insert, a by-id update and a predicate update. That includes a policy that compares such a field with a scalar comparison (`==`, `!=`, `in`, an ordering), which the read refuses with `INVALID_FILTER` / 400: there `'x'` used to get the opposite of the verdict `['x']` got, and now gets the same one.

Unchanged: a field the object does not declare multi-valued is judged as written; a list, `null`, a blank string and an object are judged as written, as the write door leaves them; the check's comparands are left as written, since `contains` takes one member; and refusals keep their code and status (`PERMISSION_DENIED` / 403).

**`@objectstack/core`** (one new root export, so `minor`; this export is the widening the `Clause-②: yes (widening)` line declares): `multiValueStorageForm(value)`, the rule itself. It wraps a string, a number or a boolean into a one-member list and returns every other value as the same value. `@objectstack/objectql`'s `normalizeMultiValueFields` now calls it, with no change in what the write door stores (`patch`). `@objectstack/plugin-security` is `minor` because the set of writes its check admits widens (the first and third rows above); that is a security-floor behaviour change, not the declared widening.

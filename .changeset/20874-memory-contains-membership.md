---
"@objectstack/driver-memory": minor
---

fix(driver-memory): `$contains` / `$notContains` on a multi-valued or JSON-stored field answer by membership, as the SQL drivers do

Clause-②: yes (widening) — one new public method on the exported `InMemoryDriver` class, `filterContainsTest`; its return type `MemoryContainsTest` is not re-exported from the package entry. No accepted filter key or operator is added: `$contains` and `$notContains` keep their declared shape.

On a field whose declaration makes it JSON-stored (`multiple: true` on a `lookup`, `user`, `select`, `radio`, `file` or `image` field, a `multiselect`, `checkboxes` or `tags` field, or a structured type such as `json`), the in-memory driver now answers `{ field: { $contains: v } }` by whole-element membership: some element of the stored array equals `v`. It used to match each element by substring, so `u1` matched a row storing `['u10']` and `'red'` matched a row storing `['redwood']`. A number member answered nothing: `{ nums: { $contains: '1' } }` missed `[1, 2]`. `$notContains` is the exact complement, and a row with no value still satisfies it. A scalar text column keeps the case-exact substring test.

`driver-sql` gives the same answer on SQLite, PostgreSQL and MySQL; the two drivers were measured over the same fixture. The answer holds on every face of this driver:

- `find()` and `count()`, in both filter spellings;
- the nested-relation filter on a multi-valued relation, which the engine lowers to one `$contains` per related id;
- `MemoryAnalyticsService`'s query, and its SQL echo, which now renders SQLite's `json_each` membership construct for such a column.

The comparand is still a string. A number or boolean member is named by its text: `'1'` matches the stored number `1` (and `'1.50'` the number `1.5`), `'true'` matches the boolean `true`, and `'null'` matches a `null` member. A field the driver holds no declaration for, such as a field on an object never passed through `syncSchema`, keeps the substring reading.

New: `InMemoryDriver.filterContainsTest(object, field, value)` returns the one test every face above lowers `$contains` to. It is a narrow seam for the analytics face, beside `filterSubstringPattern` and `filterComparandStorageForm`. The added public method is why this entry is `minor`.

**If your tests relied on the old answer:** on the in-memory driver, a filter that matched an id by prefix or a tag by substring now returns only the member rows. That is what SQL already returned in production. Write `$contains` with the whole member value.

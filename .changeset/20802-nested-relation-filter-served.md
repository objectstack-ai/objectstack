---
"@objectstack/objectql": minor
---

feat(objectql): the nested-relation filter `{ relation: { field: value } }` is served in `where`, lowered at the engine's filter seam — the drivers receive `$in` / `$contains` and are unchanged

Clause-②: yes (widening)

A condition on a related record's own fields, written beneath a relation field of the queried object — `{ "account": { "industry": "tech" } }` beneath a `lookup` — is now answered by the engine in `where`, on every verb that takes one (`find`, `findOne`, `count`, `aggregate`, `update`, `delete`) and by `judgeFilter`. It was refused with `INVALID_FILTER` / 400 until now; this supersedes the relation-field paragraph of the pending `20745-nested-object-door` entry.

**How it is answered.** The engine reads the related object with the condition, then matches the relation field against the ids that read returns, and the drivers receive only that: `{ "account": { "$in": [ids] } }` on a single-valued relation, and on a multi-valued one (`multiple: true`) an `$or` of one `$contains` per id, so it matches on any member. The relation types are `lookup`, `master_detail`, `user` and `tree`. It composes as written inside `$and` / `$or` / `$not`, and the `FilterArray` sugar lowers to it too. No related record matching selects no rows; under `$not`, a record whose relation is empty satisfies the negation.

**As the caller.** The related read is the engine's own `find` on the related object with the caller's execution context, so that object's access check, row scope and field permissions apply exactly as they do to a direct read of it. A condition on a field the caller cannot read is refused by the same check that refuses a direct filter on it (`PERMISSION_DENIED` / 403, naming the field), never answered with an empty list; a related record the caller cannot see matches no condition.

**Bounded.** At most `RELATION_FILTER_ID_CAP` (1,000, exported) related ids feed one condition. A condition matching more is refused with `INVALID_FILTER` / 400, naming the cap, the related object and the two-step route — never run over a cut-off list.

**Still refused, in the engine's words (`INVALID_FILTER` / 400, before any read):** a second level (a relation condition beneath the related object's own relation field, or a dotted key inside the condition), a key the related object does not declare, an empty condition `{}`, and a related object that is not registered. An aggregation's own `filter` and `having` keep refusing the form, and their words now name `where` as the place it is served. The dotted spelling `{ "account.industry": "tech" }` stays refused with `INVALID_FIELD` / 400, and its words now name the nested form to write instead. The structured-JSON and scalar-field refusals are unchanged.

Measured through `POST /api/v1/data/:object/query` on SQLite and PostgreSQL 16 (owner `u1`, region NA, on `d1` and `d3`; `d4` has no owner):

| `where` | before | now |
|:--|:--|:--|
| `{ owner: { region: "NA" } }` on a `lookup`, and its `master_detail` and multiple-lookup twins | `INVALID_FILTER` / 400 | `d1`, `d3` |
| `{ parent: { title: "a" } }` on a `tree` field | `INVALID_FILTER` / 400 | `d2`, `d3` |
| `{ $not: { owner: { region: "NA" } } }` | `INVALID_FILTER` / 400 | `d2`, `d4` |
| `{ owner: { region: "APAC" } }` (no owner matches) | `INVALID_FILTER` / 400 | no rows |

SQLite, PostgreSQL and the in-memory driver match the element of a multi-valued relation, so an id that is a substring of another stored id (`u1` inside `u10`) does not match it.

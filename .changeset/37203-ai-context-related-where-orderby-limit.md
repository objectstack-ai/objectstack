---
'@objectstack/spec': minor
'@objectstack/service-record-context': minor
'@objectstack/lint': minor
---

feat(ai): a context pack's related list takes `where`, `orderBy` and `limit` (ADR-0160 second amendment)

Clause-②: yes
Metadata-protocol: added

A `related` entry of an `ai_context` pack may now choose, order and cut the child rows it carries:

```yaml
related:
  - object: policy_revision
    field: policy
    fields: [version, published_at]
    where: { is_current: { $eq: true } }
    orderBy: [{ field: sort_no, order: asc }]
    limit: 5
```

- **`where`** is the object filter form on the child's own fields: `$eq`, `$ne`, `$in`, `$nin`, `$gt`, `$gte`, `$lt`, `$lte`, `$null` and `$exists` (`AI_CONTEXT_WHERE_OPERATORS`), joined by `$and` / `$or` nested at most `AI_CONTEXT_WHERE_MAX_DEPTH` (32) deep. A bare value reads as `$eq`. Refused at parse: any other operator (`$not`, `$between`, `$contains`, …), a dotted path or a condition on a lookup's target, a field-to-field comparand (`{ $field }`), a `$now` anchor, a formula, and a comparand that is one whole `{…}` placeholder (`{today}`, `{current_user_id}`, `${record_id}`, or an unknown one), and `$and` / `$or` nested deeper than the bound.
- **`orderBy`** is `{ field, order }[]` (the sort node; `direction` is refused by name) on the child's own fields.
- **`limit`** is a positive integer, at most `AI_CONTEXT_MAX_RELATED_ROWS` (20). Over it the pack is refused at parse, never lowered at call time. `RECORD_CONTEXT_RELATED_MAX_ROWS` in `@objectstack/service-record-context` is now this one number.

`get_record_context` reads such a list in the one capped child query, as the caller: the link filter and `where` joined with `$and`, ordered by `orderBy`, cut at `limit` (else the row cap), and a cut is stated in the notes. The filter grants nothing: a row the caller's row rules hide stays absent. A `where` or `orderBy` field the caller cannot query on (outside the security service's `getQueryableFields`; without that answer, any field that declares a `maskingRule`, or that the caller's schema hides or field-level security withholds) drops the whole section with the one "some material is not visible" statement, and the field is never named. A field the child does not define leaves the section out and states nothing; `os validate` and the save-time check report it as `ai-context-field-unknown`. So does an `orderBy` field the child does not offer as a sort (a formula, or a field that declares `sortable: false`, which the record doors refuse with `INVALID_SORT`): the section is left out and nothing is stated, and `os validate` and the save-time check report it as the new warning `ai-context-sort-field-unsortable`. The call's read set does not change. A door may hand the executor the caller's queryable fields through the new optional `RecordContextDoor.queryableFieldsOf`.


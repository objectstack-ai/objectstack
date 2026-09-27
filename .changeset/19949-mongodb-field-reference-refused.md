---
"@objectstack/driver-mongodb": minor
---

fix(driver-mongodb)!: `translateFilter` refuses a `{ $field }` cross-field reference instead of sending it to MongoDB as a literal value (#19949)

Clause-②: no (narrowing)

**BREAKING**: an accept-set narrowing, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. **A filter that answered before is now refused**: any filter carrying a `{ $field }` reference gets `INVALID_FILTER` / 400 from `translateFilter`, and so from every driver door that reads a `where` (`find`, `findOne`, `count`, `updateMany`, `deleteMany`, `aggregate`, `explain`).

**Security fix for RLS reads on MongoDB.** `compileCelToFilter` lowers a field-to-field comparison such as `record.s != record.t` to `{ s: { $ne: { $field: 't' } } }`. This driver has no lowering for a column-to-column comparison, and `translateFilter` sent the reference to the server as a literal sub-document. The RLS `using` clause is composed into the read after the engine's comparand checks, so nothing stopped it on the way. Measured over the rows `{ s: 'a', t: 'a' }` and `{ s: 'a', t: 'b' }`, with mingo 7.2.4 as the proxy for MongoDB's query semantics:

- `$ne` against the reference selected both rows, including the one where `s` equals `t`, and `$eq` selected none;
- `$nin: [ref]`, `$notContains: ref`, `$ne` against a reference carrying `addDays`, and `$eq` under `$not` also selected both rows;
- through `ObjectQL`, `SecurityPlugin` with a `rowLevelSecurity` policy `using: 's != t'`, and `MongoDBDriver` over a mingo-backed collection, `find` returned both rows, `count` returned `2`, and `findOne` returned the `s == t` row. The policy's read restriction was lost.

A live `mongod` was not measured, because this fleet cannot fetch the binary.

**What changes.** The driver's filter walk refuses a `{ $field }` reference in every comparand position, at any depth under `$and` / `$or` / `$not`:

- the whole comparand of any operator: the orderings, `$eq` / `$ne`, the string operators, `$null`, `$exists`;
- a member of a list: `$in` / `$nin` members, either `$between` endpoint, an array given to `$ne` or `$eq`;
- the implicit-equality position: the bare `{ field: { $field: … } }` form, or a list holding a reference;
- a reference carrying `addDays`, and a malformed reference whose `$field` is not a string.

The refusal uses the same envelope as the driver's other filter refusals. Its message names the unsupported feature (field-to-field comparison) and withholds the fields, the operator and the position, because the filter may be an access policy the caller did not write. Through the engine, an RLS read carrying such a policy is now refused with that 400, and the server is never asked. Before, it returned the unfiltered rows. A policy written `s == t`, which used to return no rows, is refused the same way.

**What does not change.**

- Every literal comparand translates to the same document as before, including literal `$in` / `$nin` / `$between` lists and `$not` around a literal.
- `$ne` with an array of literal values keeps its own refusal. An array with no reference in the equality slot still passes through `translateFilter`: the shared comparand-shape face owns that slot.
- Field-to-field comparison is not implemented on this driver. It is refused, not lowered to a MongoDB `$expr`. `driver-sql` and the in-memory evaluator are not touched.

**What an affected author does.** On a MongoDB datasource, a row-level policy or filter can compare a field only against a literal value or a `current_user` value, not against another field of the same record. A policy that needs a field-to-field comparison cannot be enforced by this driver. Before this change it returned every row.

<!-- adr-0087: not-required (no-migration-prescription) An accept-set narrowing at one driver's filter-compile door: no key, Zod schema, object definition or stored representation is added, removed or renamed, and FieldReferenceSchema is unchanged. What moves is which filters driver-mongodb answers. No stored policy can be converted to keep its meaning, because this driver has no field-to-field comparison to convert it to, so `objectstack migrate meta` has nothing to visit and there is no tombstone to mint. -->

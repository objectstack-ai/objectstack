---
'@objectstack/objectql': patch
---

fix(objectql): a `find` / `findOne` whose `fields` names a formula field returns that projection, not every stored column

Clause-②: no

To evaluate a formula field, the engine widens the projection it hands the driver to every stored column of the object (CEL's `record.<field>` reads whatever the formula needs off the full row). The rows were never cut back, so a projection that named a formula field returned every column: the tenant, owner, owning unit and audit columns, and every field the caller did not name. A flow's `get_record`, whose `config.fields` is declared as "only these fields are read", passed all of them on to its later nodes.

Each row is now cut back to the caller's projection once the read is done: the columns the caller named, plus the formula's computed value. `id` is returned only when it is named. `driver-memory` and `driver-mongodb` add `id` to every projection at the driver layer, so on those two drivers a projection that names a formula field but not `id` no longer carries `id`, while the same projection without the formula still does: name `id` when you need it. The formula still sees the full row, and so do the `afterFind` hooks and the middlewares, as before. A key an `afterFind` hook derives is kept.

Unchanged: a projection that names no formula field, and a read with no projection (every declared column, with the formulas computed). Field-level security is unchanged as well: a field the caller may not read was already masked off the widened row, and still is.

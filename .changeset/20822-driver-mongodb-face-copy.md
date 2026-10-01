---
'@objectstack/driver-mongodb': patch
---

fix(driver-mongodb): `MongoDBDriver` compiles the whole-day comparison it is handed — its own copy of the bare-day upper bound is deleted (ADR-0053 D-D1 items 5, 7 and 9, #20822)

Clause-②: no

- **What is deleted.** `translateFilter` no longer widens a bare `YYYY-MM-DD` `$lte` to `$lt` the next day, no longer widens a `$between` maximum the same way, and no longer turns `$lte '9999-12-31'` into `$ne: null` or drops a `$between` maximum on that day. Every verb that translates a `where` inherits it: `find`, `findOne`, `count`, `updateMany`, `deleteMany`, `explain`, and the `$match` stage of `aggregate` / `buildAggregationPipeline`.
- **A read through the engine or the RLS compile seam is unchanged.** The seam hands the driver a filter the shared `lowerFilterCondition` (`@objectstack/spec/data`) has already rewritten on the declared `datetime` columns: `$lt` the next day, a split `$between`, `$null: false` on the last supported day. The deleted copy gave the same answer on that input. A `date` column answers as before, because its stored calendar-day text orders the same either way.
- **Two answers converge on what `SqlDriver` returns** (ADR-0053 D-D1 item 7's scope). On a registered object, a bare-day `$lte` or `$between` maximum is now compared as written on a column that is not declared `datetime`: a `text` column holding ISO instant text, or a column the object does not declare. This driver used to widen it to the whole day.
- **A caller that passes no seam gets the comparison it wrote** (item 5): a `MongoDBDriver` verb or `translateFilter` called directly. A bare-day `$lte` compares against that day's midnight, a `$between` is inclusive at both ends, and `$lte '9999-12-31'` compares against that midnight. To keep the seam's reading on a direct call, lower the filter first: `driver.find(object, { where: lowerFilterCondition(where, { isDatetimeColumn }) })`, with `lowerFilterCondition` from `@objectstack/spec/data`.
- No exported name changes.

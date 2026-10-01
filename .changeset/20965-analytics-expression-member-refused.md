---
'@objectstack/service-analytics': patch
---

fix(service-analytics): the analytics field-level read gate refuses a cube member whose `sql` names no field, instead of letting the query run (#20965)

Clause-②: no

**What changed.** Where the analytics field-level read gate judges a cube's
object (a security service is registered and gives a field answer for that
object), a query that names a cube member whose `sql` is neither a column
reference (a field of the cube's object, or a relationship path ending in one)
nor `'*'` is now refused `403 PERMISSION_DENIED` on
`POST /api/v1/analytics/query` and `POST /api/v1/analytics/sql`, before either
strategy runs. Whatever
the caller may read, the member is refused. That covers an expression member
of a cube that reached the service without the spec's parse (the cube
registry never parses: `analyticsCubes` and `AnalyticsServicePlugin({ cubes })`
arrive as written), a declared member with no `sql` string, and a member the
query names itself that is not a column reference. The gate used to stand down
on such a member, because it names no field, and the native-SQL strategy then
compiled it into its statement as written: a read of fields no permission
verdict was reached for. The refusal names the member and the object, and
never the member's `sql`.

**What is not affected.** A member that is a column reference is judged by the
field it resolves to, as before. A `count` over `'*'` names no field and is
served. A deployment with no security service, and an object the security
service gives no field answer for, apply no field-level check, as before. The
spec's parse already refuses an expression member, so a cube that parses is
unaffected.

**If a widget stopped answering,** its cube carries an expression member from
before the parse refused one. Re-author the member as a column reference, or
declare the derived value on an ADR-0021 dataset: a conditional count or sum
is a dataset measure with its own `filter`, and a ratio of measures is
`derived: { op: 'ratio', of: [...] }`.

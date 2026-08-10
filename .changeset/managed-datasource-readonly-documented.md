---
"@objectstack/spec": patch
"@objectstack/example-crm": patch
---

docs(spec): managed-datasource read-only is a database privilege, and the platform will not add a flag (#4584)

#4583 removed `datasource.capabilities.readOnly` and left a gap open in its
rejection message: `external.allowWrites: false` is the one enforced write gate
and it covers only FEDERATED datasources, so a **managed** datasource had no
read-only gate at all. The rejection pointed at #4584 and said "tracked". #4584
is now answered, and the answer is that this stays so **on purpose**:

> **方案 B —— 不建平台层只读闸门，文档明确记录**。
> 一个只拦 ObjectQL 写路径、拦不住直连/迁移/DDL 的位，是「看起来存在的能力」——
> #4583 刚删掉的 `capabilities.readOnly` 就是这个形状，不再造第二遍。真只读属于
> 数据库账号权限（GRANT SELECT），那里没有绕行面。

Read-only for a database ObjectStack owns is a **database account privilege** —
`GRANT SELECT`. An ObjectQL-level flag would stop writes on one path and leave a
direct `psql` session, a migration, a `syncSchema()` DDL statement and any
process sharing the connection string untouched. A boundary that holds in one
path is not a boundary, and one that looks like a boundary is worse than none
because it gets trusted — which is exactly the defect #4583 removed.

Documentation-only. No schema shape changes; the `capabilities.readOnly`
tombstone now carries the answer instead of an open issue reference:

- **Database Drivers** gains *Read-only: grant it at the database, not in
  metadata* (a worked `GRANT SELECT` role, the DDL/schema-sync consequence, why
  the platform declines the flag, and a table of what actually enforces what)
  and *Read replicas: the platform does not route* — the #4479 dual conclusion:
  no query path separates reads from writes, so put replicas behind pgpool /
  ProxySQL / an RDS reader endpoint and point `config` there. That is the
  correct answer, not a stopgap.
- **External Datasources** now says plainly that the double opt-in write gate is
  federation-only, and that the parse rejects an `external` block on a `managed`
  datasource.
- `example-crm`'s `crm_analytics` header comment recorded the ruling instead of
  waiting on it.

---
"@objectstack/driver-sql": patch
---

fix(driver-sql): `Field.date` + `defaultValue: 'NOW()'` records the UTC calendar day on Postgres/MySQL (#4022)

The bare `CURRENT_TIMESTAMP` default resolved the calendar day in the SERVER's
timezone on Postgres — measured: a UTC-12 server recorded yesterday; an
Asia/Shanghai server records tomorrow for every default after 16:00 UTC — and
MySQL 8.0 rejects it on a DATE column outright (MariaDB is merely permissive,
and the driver's UTC-pinned session masked the semantic half there).
`nowColumnDefault` now emits a UTC expression default on both dialects, the
#3994 D-C3 construction one type over. Defaults only govern newly created
columns; existing columns keep their legacy default, per the standing D-B3
policy.

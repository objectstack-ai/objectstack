---
"@objectstack/spec": patch
---

fix(spec): correct the stale "passed to `mysql2` verbatim" TS doc comment on `MysqlConfigSchema.ssl` (mysql.zod.ts) — since #8874, the resolved `true` is translated into mysql2's own default TLS options (`rejectUnauthorized: true`) before mysql2 sees it, because mysql2 rejects a bare boolean outright. Comment-only; accept/reject behaviour is unchanged, and the shared `DriverSslToggleSchema.describe()` (correct for the postgres/turso arms, which do pass the boolean verbatim) is untouched (#9125)

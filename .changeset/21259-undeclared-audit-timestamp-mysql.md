---
'@objectstack/driver-sql': patch
---

On MySQL, a write to an object that does not declare `created_at` or `updated_at` no longer fails with `Incorrect datetime value … for column 'updated_at'`. The driver creates both columns on every table it builds, and the engine stamps both on every insert as ISO-8601 text (`2026-10-01T21:49:27.479Z`). Only a column the object declared as `Field.datetime` was rewritten into the `2026-10-01 21:49:27.479` form MySQL accepts. The engine declares both columns on most objects, but not on an object with `managedBy: 'better-auth'` or `systemFields: false`, so those writes were refused.

Clause-②: no

**What this fixes.** `sys_jwks` declares `created_at` only, so on MySQL the JWT signing key was never stored. `GET /api/v1/auth/jwks` and `GET /api/v1/auth/token` answered 500, `get-session` carried no `set-auth-jwt` header, and no OIDC or MCP token could be issued. `sys_member` failed the same way, so the seeded admin had no organization membership. Now both answer 200, the key is stored, and the membership is stored. In the CRM example's boot, 9 objects declare `created_at` without `updated_at` and 2 declare neither. Every write door formats the column: `create`, `bulkCreate`, `upsert`, `update` and `updateMany`.

**SQLite and PostgreSQL.** The value the engine stamps is bound unchanged on both, so their behaviour is the same. One input shape changes on SQLite: a JS `Date` written to an undeclared audit column is now stored as the canonical ISO text, as it already is for a declared `Field.datetime`. Before, it was stored as epoch milliseconds and read back as a number. A column the object declares keeps its declared type.

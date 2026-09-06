---
'@objectstack/cli': patch
---

`os generate migration`: the builtin `created_at` / `updated_at` columns now match `driver-sql` on nullability and default text, and the SQL format declares itself PostgreSQL-only.

Both formats emitted `NOT NULL` on the two audit-stamp columns while the driver creates them nullable, and the SQL format spelled their default `now()` while both knex producers emit `CURRENT_TIMESTAMP`. Nothing failed either way, but `information_schema` kept the pair textually apart forever, so a schema diff between a generated table and a platform-created one was permanently noisy. Both generators now follow the driver — the same rule the `id` column already follows — and `--format sql` states in its help text and its docblock that it targets PostgreSQL only and makes no MySQL or SQLite claim.

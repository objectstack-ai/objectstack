---
'@objectstack/cli': patch
'@objectstack/driver-sql': patch
---

fix(cli): `os migrate plan` / `apply` / `unmapped-columns` examine what `os serve` mounts around the stack, so the retired `sys_account.issuer` is finally a drop (#22506)

`os migrate plan` and `os migrate apply` only examine the objects their own boot registers, and that boot stopped at the stack: its config, its metadata and the platform floor. Nothing `os serve` mounts around a stack was there. On an app declaring `requires: ['auth']`, the plan examined 9 of the 68 tables the serving boot had created. `sys_account` read as an undeclared platform table, so its retired `issuer` column (and that column's unique index) was never a destructive drop. `os migrate apply --allow-destructive` dropped nothing, while the boot's drift line and `os migrate account-issuer` kept prescribing exactly that command.

The two commands now also compose, each through the rule `os serve` itself reads, and so does `os migrate unmapped-columns`, which reads the plan's own `unmapped_column` findings and therefore needs the plan's object set:

- the auth family behind `serve`'s auth gate: plugin-auth's identity objects, the security plugin and the audit plugin, when the stack mounts no `AuthPlugin` of its own, the `auth` tier is on, and an auth secret resolves;
- the provider of every capability `serve` mounts: the stack's `requires` and the always-on slate, as `os serve` composes it with no `--preset`;
- the REST API plugin;
- every `plugins` entry by `serve`'s rule for one: a package name is loaded from the app, and a plain bundle is wrapped as an app;
- the pinyin-search decision from the config's locales, so the `__search` companion columns a boot provisions are no longer listed as destructive drops on a config-only project.

`os migrate unmapped-columns --object sys_account` (or any platform object the plan now declares) resolves the object and reads its unmapped columns, where it used to answer `OBJECT_NOT_FOUND`.

Each piece is composed for its declarations only. Its `init()` runs, and its `start()` and lifecycle hooks do not, so no dispatcher, scheduler or seed runs inside a dry run.

**What an operator sees.** On the shape that looped, `os migrate plan` lists `sys_account.issuer` and `uniq_sys_account_issuer_account_id` as destructive drops. `os migrate apply --allow-destructive` drops both, `os migrate account-issuer` reads zero, and the next boot prints no drift line for them. When no auth secret is set and the boot is not a development one, the plan says it did not compose the auth family, and how to compose it: run with the deployment's `OS_AUTH_SECRET`.

**driver-sql.** The deferred-DDL preview answers a rotation-declared object (`lifecycle.storage.strategy: 'rotation'`, such as `sys_activity`) from the rotator's facts: when the current shard and the read view exist, nothing is pending. It used to list `create_table` for such an object on every plan, and `apply` then created nothing.

**Known limit.** A development boot, or one with `OS_TELEMETRY_DB` set, keeps lifecycle-classed objects in a sibling `telemetry` database. The one-shot migration boot does not provision that database, so it examines those objects against the primary one.

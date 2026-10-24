---
'@objectstack/plugin-auth': minor
'@objectstack/cli': patch
---

fix(plugin-auth): `os migrate apply`'s `sys_account.issuer` pre-flight report names each colliding row's stored issuer instead of `(none)`

Clause-②: yes (widening)

`probeAccountIdentityCollisions` read `sys_account` through the engine's `find`. The engine answers declared columns only, and the shipped `sys_account` no longer declares `issuer`, so the report `os migrate apply --allow-destructive` prints when it refuses the `sys_account.issuer` drop labelled every colliding row's issuer `(none)`, in the human report and in the `--json` document's `preflight.collisions[].issuers` alike. `os migrate account-issuer` read the same database through the driver and printed the stored values. The issuers are what an operator needs to decide which colliding row survives.

- **`@objectstack/plugin-auth`.** When its source offers the storage door (`getDriverForObject`, as the `objectql` engine both CLI doors pass does), the probe reads `sys_account` through the driver the engine routes that name to, and through nothing else: a missing driver is refused, never answered from the engine's `find`. A source that offers `find` alone is still read as handed. A new option, `onTableAbsent`, reads a missing `sys_account` table as no rows and reports that it did. Without it, a missing table is refused like any other failed read.
- **Widened public surface (`@objectstack/plugin-auth`).** The package entry re-exports the pre-flight module, so it now publishes two new types, `AccountTableStorage` (`getDriverForObject`) and `AccountTableDriver`, and a new option, `AccountIdentityPreflightOptions.onTableAbsent`. `probeAccountIdentityCollisions` now accepts `AccountTableStorage | AccountIdentityReadEngine` as its source. Every earlier caller still type-checks, and nothing narrows.
- **`@objectstack/cli`.** `os migrate account-issuer` reads through the probe's reader instead of its own, so it and `os migrate apply` read one table one way. Its output is unchanged.

**Unchanged.** The collision verdict (`ok`, the colliding keys, row ids, users, counts), the `apply` refusal and its exit code. A database whose `sys_account` has no `issuer` column reports each row as `(none)`, as before.

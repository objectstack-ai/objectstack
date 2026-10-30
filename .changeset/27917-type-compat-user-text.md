---
'@objectstack/spec': patch
---

fix(spec): a `user` field over a text column passes the external-datasource type check; ADR-0015 names the `odata` vocabulary

Clause-②: yes (widening)
Metadata-protocol: none

- **Type matrix (`@objectstack/spec/data`).** `user` is now exact under the `text` row, as it already was under `uuid`. A `user` field's target is fixed to `sys_user`, so its column holds a platform user id, which is a string: better-auth mints 32 alphanumeric characters, and the SQL driver mints a 16-character nanoid for a row the engine writes without one. Before, `isCompatible` refused a `user` field over a `varchar` / `Edm.String` column as a `type_mismatch` error, so the boot validation (`onMismatch: 'fail'`) refused a federated object that declared one. Nothing that passed before fails now.
- **Integer rows unchanged.** A platform user id is never an integer, so `user` stays refused under `integer` / `bigint` (`Edm.Int32`, `Edm.Int64`), even though `lookup` and `master_detail` are exact there.
- **ADR-0015 §4.6** lists `odata` among the dialects the matrix knows, pointing at `DIALECT_ALIASES.odata`.

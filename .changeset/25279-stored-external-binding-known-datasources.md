---
'@objectstack/spec': patch
'@objectstack/metadata-protocol': patch
---

fix(spec): `os migrate meta --stored` lists a stored object bound `external` to a stored or registered managed datasource

Clause-②: yes (widening)

Metadata-protocol: none

The stored-shape listing for `object-external-binding-managed-datasource-refused` resolved an object's named datasource only from the stack being converted. A stored object row reaches the conversion chain alone, so the listing judged only a binding on the primary datasource (`'default'`), while the object save door also refuses one on a datasource stored or registered beside the object. The stored-metadata pass therefore did not list a stored object row bound `external` to a managed datasource, the row whose next save is refused with `422 INVALID_METADATA`.

- **Now:** for each stored `object` row carrying `external` and naming a datasource, the pass reads that datasource the way the object save door does (the environment's stored row, else the definition the code layer registers; both go through one read) and hands it to the chain. The row is listed under `rows[].todos` with this entry's id exactly when that door refuses its next save. A datasource declared `schemaMode: 'external'` or `'validate-only'`, and a datasource no layer holds, give no listing, as at the door. Nothing is rewritten.
- **`@objectstack/spec`:** `ApplyConversionsOptions` (and so `StoredConversionOptions` for `applyConversionsToStoredItem`) gains an optional `knownDatasources`, a map of datasource definitions by name that the caller's door can see beyond the stack. Only the refused-shape listing reads it, so only when an `onTodo` sink is passed. A datasource the stack declares is read from the stack first. Without it, behaviour is unchanged.

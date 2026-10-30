---
'@objectstack/plugin-sharing': patch
---

fix(plugin-sharing): a refused write on a federated object whose mapped owner column the driver did not serve is logged again

Clause-②: no
Metadata-protocol: none

A federated object that maps a remote column onto `owner_id` through `external.columnMap`, served by a plugin driver that does not apply the map, returns rows with no `owner_id`, so every member edit or delete is refused. The refusal is unchanged. Since the mapped class stopped counting as a phantom owner anchor, the one-line server warning that tells the operator why had stopped firing. It fires again, at most once per object, as the new `UNSERVED_OWNER_WRITE_DENY_NOTICE`, which names the driver returning no value for the mapped or declared owner column. A driver that serves the column, including a row whose owner is NULL, stays silent.

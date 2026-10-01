---
'@objectstack/spec': patch
---

docs(spec): `mapping.connectorSource` is pulled when a job drives it — the describes say where the watermark is read from and that a pull reads one response (#20919)

The `connectorSource` describe no longer says the pull is not executed: the
connector sync executor in `@objectstack/service-automation` reads the binding,
and nothing schedules a pull until the `job` stage lands. `watermark.field` now
states that the next pull's starting point is read from the TARGET field a
`fieldMapping` entry copies it onto (an unmapped one is refused at pull time), and
`watermark` states the one-response limit: the connector's paging is not followed,
so a paged endpoint yields its first page only. The liveness ledger's
`connectorSource` rows are `live`, with no author warning: that nothing schedules a
pull yet is said on the key's description. The retired `connector.syncConfig`
prescription and the `connector-sync-keys-retired` upgrade entry say the same, and
the entry's acceptance criterion no longer claims the connector is validated at
authoring.
No key, value or default changed.

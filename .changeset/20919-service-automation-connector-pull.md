---
'@objectstack/service-automation': minor
---

feat(service-automation): the connector sync executor pulls a `mapping`'s `connectorSource` and writes it through the import runner (#20919)

`AutomationServicePlugin.pullConnectorSource({ mapping, context })` (and the
exported `pullConnectorSource(deps, opts)`) reads the mapping through the
protocol's `getMetaItem`, resolves `connectorSource.connector` to a declared
(`connectors[]`) `rest` or `openapi` instance, makes ONE call to its read action,
takes the array at `recordsPath` (default `body`), projects it through the
mapping's `fieldMapping` and writes it with `@objectstack/core`'s `runImport` —
the import door's coercion, `mode` / `upsertKey` matching and per-row verdicts,
with the door's defaults for every knob `connectorSource` does not declare.

- **Watermark, read from the target.** For `connectorSource.watermark`, the
  starting point sent as `query[watermark.param]` is the highest value already
  stored in the target field a `fieldMapping` entry copies `watermark.field` onto
  (transform `none`). Nothing else stores it.
- **One response per pull.** The connector's paging is not followed.
- **Loud refusals,** each a `ConnectorPullError` (`code`, `status`, `reason`)
  raised before anything is written: a plugin-registered or unregistered
  connector, a degraded instance, a provider other than `rest` / `openapi`, an
  undeclared action, `update` / `upsert` with an empty `upsertKey`, a
  `javascript` transform, an unmapped `watermark.field`, an `ok: false` answer,
  a non-array at `recordsPath` and a non-object record.
- **Nothing schedules a pull** — a `job` will drive it; the caller supplies the
  execution context.

The plugin now records the provider of each declared connector instance it
materializes, which the executor reads.

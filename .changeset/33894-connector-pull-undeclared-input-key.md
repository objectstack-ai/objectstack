---
'@objectstack/service-automation': minor
'@objectstack/spec': minor
---

fix(service-automation)!: the connector pull door refuses an input key its read action does not declare, as the `connector_action` node does

Clause-②: no (narrowing) — a mapping whose `connectorSource.input`, or the watermark parameter the pull adds to its `query`, carries a key the read action's `inputSchema` does not declare used to pull and send that key to the provider; the pull now fails before the call. Nothing published widens: no export, no key, no option is added. First-party mappings affected: 0 (no `connectorSource` under `examples/` or `packages/apps/`).
Metadata-protocol: narrowed

<!-- adr-0087: registered connector-pull-undeclared-input-key-refused -->

**BREAKING** for a mapping pulled through `connectorSource` whose input holds a key the read action does not declare. Every door that dispatches a connector action now judges its input alike: the pull judges the input it is about to send, the watermark parameter included, by the rule the `connector_action` node has applied since 18.5.0, and refuses with `code: 'VALIDATION_ERROR'` (status 400) before the action is called, naming each undeclared key by its dotted path and the keys the action declares at that level. Nothing is pulled and nothing is written.

A scheduled pull has no `fault` edge: a job whose `pull` names such a mapping fails every run (its `sys_sync_run` row ends `failed`, and the job's `retryPolicy` applies) until the mapping or the action's document is fixed.

The key the pull adds itself is judged too. With `connectorSource.watermark`, the pull sends the highest stored value of the target field as `query[watermark.param]` — but only once the target holds a value, so a mapping whose first pull wrote rows fails from its second pull on. An `openapi` connector declares only the query parameters its OpenAPI document names, so an operation that does not name the watermark parameter (or names none in `query` while declaring a parameter elsewhere or a body) refuses it; the refusal names the parameter. An operation with no parameter and no body has no `inputSchema`, so nothing is judged and the watermark is sent; it starts refusing the watermark the day the document gives it its first parameter or a body, unless the watermark parameter is declared with it. A `rest` connector's `request` action declares `query` with no `properties`, which reads as open, so its query keys, the watermark included, are not refused.

Migration, FROM → TO:

- A stray key the author wrote: `connectorSource: { connector: 'crm_api', action: 'list_contacts', input: { query: { limit: 50, stale: 'x' } } }` → drop `stale` from `input`, or declare it in the action.
- The watermark parameter on an `openapi` connector: `watermark: { field: 'updated_at', param: 'since' }` over an operation whose document lists only `limit` → add `{ name: 'since', in: 'query', schema: { type: 'string' } }` to that operation's `parameters` in the OpenAPI document (its declared type must be the target field's), then let the connector re-materialize.

`GET /api/v1/automation/connectors` lists each action's `inputSchema`, which is what the pull judges against. Which schemas declare their keys is the `connector_action` node's rule, unchanged: an object schema that lists `properties`, or says `additionalProperties: false`; one that admits more keys (`additionalProperties` true or a schema, `patternProperties`, a composition keyword, `$ref`) or lists no `properties` still sends every key, and so does an action with no `inputSchema`.

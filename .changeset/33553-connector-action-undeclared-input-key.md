---
'@objectstack/service-automation': minor
'@objectstack/connector-openapi': minor
'@objectstack/spec': minor
---

fix(service-automation)!: a `connector_action` node refuses an input key its action does not declare, instead of sending it to the provider

Clause-②: no (narrowing) — a flow whose `connector_action` node carries a key in `connectorConfig.input` that the chosen action's `inputSchema` does not declare used to run and send that key to the provider; its step now fails before dispatch. First-party flows affected: 0 (the shipped DocuSign, Stripe, GitHub and showcase flows send only declared keys).
Metadata-protocol: narrowed

<!-- adr-0087: registered connector-action-undeclared-input-key-refused -->

**BREAKING** for a `connector_action` step whose input holds a key the action does not declare. The step now fails with `code: 'VALIDATION_ERROR'` before the handler is called, naming the node, each undeclared key by its dotted path, and the keys the action declares at that level; nothing is sent. The failure is a `runtime` one, so a `fault` edge on the node receives it, as for a missing required parameter or a value of the wrong type. A connector or action switch in the designer is the usual way such a key is left behind.

Migration, FROM → TO: `connectorConfig: { connectorId: 'slack', actionId: 'chat.postMessage', input: { channel: 'C1', text: 'hi', stale_key: 'x' } }` → drop `stale_key` from `input`, or pick the action that declares it. A key is judged at every object level the walk reaches, array items included, against the schema of that level (`input.query.stale` against the `query` properties of an OpenAPI action), and a CEL envelope is judged on the map it evaluates to.

An action whose schema lists only some of the parameters its handler forwards refuses the others now. The Slack connector's `chat.postMessage` and `chat.update` list `channel`, `text`, `blocks` and `thread_ts` / `ts` and forward the whole input to the Slack Web API, so any other Slack parameter (`unfurl_links`, `mrkdwn`, `reply_broadcast`, …) on those two actions is refused. Migration, FROM → TO: `{ actionId: 'chat.postMessage', input: { channel: 'C1', text: 'hi', unfurl_links: false } }` → `{ actionId: 'call', input: { method: 'chat.postMessage', params: { channel: 'C1', text: 'hi', unfurl_links: false } } }`; the `call` action's `params` is an object with no `properties`, so it carries any Slack parameter.

`@objectstack/connector-openapi`: what the generator cannot read without de-referencing the document is now declared open instead of left out, so a flow over an OpenAPI 3.x document nobody normalized keeps dispatching. An unresolved `$ref` parameter has no readable `in`, so it opens every location the handler sends: `path`, `query` and `header` are each emitted with `additionalProperties: true`, also when they declare no parameter of their own, and the parameters declared beside them are still judged. An unresolved `$ref` request body, or one whose content carries no `schema`, is declared as `body: {}` (any value). Running `normalize-openapi` over the document still gives each such parameter its own declaration and type check.

Which schemas declare their keys: an object schema that lists `properties`, or says `additionalProperties: false`; the declared keys are the names in `properties` plus those in `required`. A schema that admits more keys declares open input and every key still dispatches: `additionalProperties` set to `true` or to a schema, `unevaluatedProperties` other than `false`, `patternProperties`, `$ref`, `$dynamicRef`, `$recursiveRef`, `allOf` / `anyOf` / `oneOf`, `if` / `then` / `else`, `dependentSchemas` or `dependencies`; so does a schema that lists no `properties`, and an action with no `inputSchema`. An undeclared key whose value is `undefined` is absent and not refused; any other value, `null` included, is.

Judged at run time, against the schema of the instance the call dispatches to, and not when the flow registers: the boot flow pull registers every flow before a declarative connector materializes, and an instance's schema is re-read from its upstream on every re-materialization, so a registration-time verdict could be contradicted later in the same boot. The connector pull door (`connectorSource.input`) is unchanged.

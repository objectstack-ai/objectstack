---
'@objectstack/service-automation': patch
---

fix(service-automation)!: a connector pull whose input breaks the read action's declared `inputSchema` is refused before the action is called, with `VALIDATION_ERROR` naming each parameter (#28040)

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export, type or error code is removed or renamed: `MappingSchema.connectorSource` and `ConnectorActionSchema.inputSchema` keep their shapes, and the refusal reuses the existing `VALIDATION_ERROR` code the pull door already answers its other input faults with. What narrows is the run-time dispatch of the connector pull: a call the action's own declared schema says is wrong is no longer sent upstream. Nothing stored is rewritten or re-judged at rest, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. -->

**BREAKING** (an accept-set narrowing at run time), shipped as `patch`: nothing a metadata author writes changes shape (`Metadata-protocol: none`), so the level follows the kind, and the banner and the ADR-0087 disposition stay.

**FROM.** `pullConnectorSource` (the door a `job`'s `pull` runs) built the action's input from `connectorSource.input` plus the watermark parameter and called the connector's handler with it unchecked. The check the `connector_action` flow node gained in #27995 did not cover this door, so a pull whose input missed a parameter the action declares `required` still reached the remote API; for an OpenAPI `getPet`-style action the path placeholder was sent literally.

**TO.** The input the pull is about to send, with the watermark parameter added, is judged against the action's `inputSchema` by the same check the `connector_action` node runs (one shared helper, so the two doors judge alike: `required`, `type` with OpenAPI 3.0 `nullable`, descent through `properties` and `items`; keywords outside that subset never refuse). A failing input throws `ConnectorPullError` with `code: 'VALIDATION_ERROR'`, `status: 400` and the new `reason: 'input_schema_mismatch'`, naming each problem by its dotted path (`missing required 'query.since'`, `'query.limit' must be integer, got string`); a text value where a number or boolean is declared adds a hint to write it as that JSON type (no CEL runs on this door, so there is no cast to suggest). The action is not called and nothing is written, so the job run is recorded `failed` and its `retryPolicy` applies. An action that declares no `inputSchema` pulls whatever it is given, as before. The `connector_action` node's behaviour and messages are unchanged.

**TypeScript.** `ConnectorPullRefusalReason` gains `'input_schema_mismatch'`, and `ConnectorPullRegistry` now requires `getConnectorDescriptors()` (where the action's `inputSchema` is read). The automation engine already has it; a hand-built registry passed to `pullConnectorSource` adds it.

**Who sees it.** A `mapping` whose `connectorSource.input` omits a parameter the read action declares `required`, or sends one of a type the action does not declare: its pull now fails before the call instead of the remote answering it. A required parameter that only the watermark supplies is absent on the first pull (nothing is stored yet), so that pull is refused too.

**Fix.** Make `connectorSource.input` satisfy the action's `inputSchema`, which `GET /api/v1/automation/connectors` lists: supply every required parameter, and write each one as the declared type (`{ query: { limit: 50 } }`, not `{ query: { limit: '50' } }`). The watermark parameter is sent as the value stored in its target field, so the action must declare that parameter with the stored field's type (a text or datetime field ⇒ `string`, the ISO form a pull sends for a date), and must not declare it `required` unless `connectorSource.input` also gives it a first value.

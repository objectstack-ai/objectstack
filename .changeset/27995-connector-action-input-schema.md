---
'@objectstack/service-automation': patch
---

fix(service-automation)!: a `connector_action` call whose evaluated input breaks the action's declared `inputSchema` fails the step before dispatch, naming each missing or mistyped parameter, and nothing is sent (#27995)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export, type or error code is removed or renamed: `ConnectorActionSchema.inputSchema` and `connectorConfig.input` keep their shapes, and the refusal reuses the existing `VALIDATION_ERROR` code of the platform vocabulary. What narrows is the run-time dispatch of one node: a call the action's own declared schema says is wrong is no longer sent upstream. Nothing stored is rewritten or re-judged at rest, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. -->

**BREAKING** (an accept-set narrowing at run time), shipped as `patch`: nothing a metadata author writes changes shape (`Metadata-protocol: none`), so the level follows the kind, and the banner and the ADR-0087 disposition stay.

**FROM.** The `connector_action` node evaluated `connectorConfig.input` and handed it to the connector's handler unchecked. The action's declared `inputSchema` (built from the OpenAPI operation by `connector-openapi`, passed through from `tools/list` by `connector-mcp`, or written by a code connector such as `connector-slack`) was advisory: a call to an OpenAPI `getPet` with `input: {}` reached the remote URL although `petId` is declared `required`, and what came back was the remote's choice.

**TO.** After the input's value slots are evaluated and before the handler is called, the evaluated input is judged against the action's `inputSchema`:

- Judged: `required` at every object level reached, `type` (a type list, OpenAPI 3.0 `nullable: true`, and `integer` as a whole number), and descent through `properties` and array `items`.
- Not judged, so never refused here: `$ref`, `oneOf` / `anyOf` / `allOf`, `enum`, `format`, bounds, `pattern`, `additionalProperties`, and any `type` name outside the JSON Schema seven. The remote still judges those, as before. An action that declares no `inputSchema` dispatches whatever it is given.
- A failing call fails the step with `code: 'VALIDATION_ERROR'` on `$error`. The error names each problem by its dotted path (`missing required 'path.petId'`, `'query.verbose' must be boolean, got string`, `'tags[1]' must be string, got number`), says nothing was sent, and points at `GET /api/v1/automation/connectors`, which lists the action's schema. The handler is never called.
- The failure is a `runtime` one, not a guard refusal: the input can come from run data, so a `fault` edge or a `try_catch` region can handle it.

**Who sees it.** A flow or agent whose `connector_action` input omits a parameter the action declares `required`, or sends one of a type the action does not declare: that step now fails before the call instead of the remote answering it. For example, an OpenAPI path parameter declared `type: integer` sent as the string `"7"` is refused, where the provider used to interpolate it into the path.

**Fix.** Make `connectorConfig.input` satisfy the action's `inputSchema`: supply every required parameter, and send each one as the declared type (`{ path: { petId: 7 } }`, not `{ path: { petId: '7' } }`). A value computed by a CEL envelope is judged on what it evaluates to.

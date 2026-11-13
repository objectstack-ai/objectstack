---
'@objectstack/spec': minor
'@objectstack/metadata-core': minor
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@objectstack/plugin-approvals': patch
---

fix(approvals): a non-admin approver can open an approval request again — the request definitions are served to the callers the approvals door admits, declared by the object's owner as `schemaReadDelegate`

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: none — `schemaReadDelegate` is a plugin-owned delegate key like `fileAccessDelegate`, which no published skill teaches; it names a kernel service, and only plugin code can provide one

Since the metadata API began answering an object the caller may not read as absent (ADR-0106 as amended by ruling record 6787890900), a non-admin approver got `404` on `GET /api/v1/meta/object/sys_approval_request` and `…/sys_approval_action`. Both objects are closed on the data side on purpose, and their rows reach a member only through `/api/v1/approvals/*`, so the console request page lost its definition: every inbox row, `?request=` link and record panel showed "Object Not Found" with no decision actions. The maintainer's decision (6840464379) keeps that rule and makes these two definitions visible to the callers the approvals door admits, declared by the owning plugin.

- **`@objectstack/spec`: `ObjectSchema.schemaReadDelegate`.** An optional service name, beside `fileAccessDelegate`. The named kernel service implements `authorizeSchemaRead(objectName, context)` and is asked only after the object read check refused the caller; a `true` verdict serves the object's definition, and only the definition, exactly as to a reader of the object: in the object list and by name, projected by the caller's own field-level security. The data door's answer about the rows does not move. A declared service that is missing or does not implement the method leaves the object absent; one that throws is a 5xx fault, never a false absence.
- **`@objectstack/metadata-core`:** `resolveObjectSchemaMaskPosture` takes an optional `schemaReadDelegates` source and asks the object's declared delegate after `canReadObject` refused, never on an undetermined field posture (that would serve the schema unmasked). `objectSchemaReadDelegateSource` builds the source from a transport's engine and service lookups; `ObjectSchemaReadDelegate` is the method's shape. An outlet that hands no source applies no exception.
- **`@objectstack/rest` and `@objectstack/runtime`:** both object-schema maskers hand the posture resolution a source over the request's environment, so every schema-serving outlet on both transports (item, layered, published, diff, object state, app bundle, list, and the HTTP MCP object tools) gives one answer. `RestServer` takes a by-name service lookup as a new last constructor argument, which `RestApiPlugin` wires.
- **`@objectstack/plugin-approvals`:** `sys_approval_request` and `sys_approval_action` declare `schemaReadDelegate: 'approvals'`, and `ApprovalService.authorizeSchemaRead` admits the callers its door serves at least one request to, by the rule its request read applies: a current approver, the submitter, a past actor or commenter, or the override holder. A member party to no request keeps the `404`, and every other object keeps its answer.

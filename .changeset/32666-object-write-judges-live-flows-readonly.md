---
'@objectstack/lint': minor
'@objectstack/metadata-protocol': minor
'@objectstack/spec': minor
---

fix(lint, metadata-protocol)!: an object publish that makes a field readonly while a live flow of the same package writes it as the user is refused, naming the flow, instead of publishing clean and leaving the flow's button to succeed and change nothing

Clause-②: yes (narrowing) — the runtime object write doors (package publish and the live save) refuse an object they accepted before: one that makes a field `readonly` while a live `runAs: 'user'` flow of the same package writes it from an `update_record` or `create_record` node. A field made `readonlyWhen` publishes with the `flow-update-readonly-when-field` advisory. Only conflicts the write adds are charged: a conflict already on the tenant is not. Measured first-party: 0 (34 objects and 45 flows across `examples/*` and `packages/apps/*`, each object written as an update and as a create; 4 of 4 positive controls refused). The accept set at the doors only narrows; the `yes` is the `@objectstack/lint` type surface, which grows by four optional fields, each reachable from the package entry: `ReferenceIntegrityRule.subjects`, `ReferenceIntegrityRunOptions.subjectPass`, `AuthoringRuleContext.subjectPass`, and the `subjectObjects` argument of `runRuntimeAuthoringRules`. Omitted, each leaves a caller's verdict as it was.
Metadata-protocol: narrowed
Skills-docs: none — `skills/objectstack-automation` and `skills/objectstack-data` already teach that a `runAs: 'user'` write to a `readonly` field is stripped and that a flow maintaining one runs `runAs: 'system'`; the refusal names the flow and node and carries that remedy. The limit that callout leaves out (a button starts an elevated flow only as a `screen` or `api` flow; an autolaunched one answers 403) is #32832, open in the skills lane.

<!-- adr-0087: registered object-readonly-field-written-by-live-flow-refused -->

**BREAKING** accept-set narrowing at the runtime object write doors: `POST /api/v1/packages/:id/publish-drafts` and the active save of an object.

A `runAs: 'user'` flow that writes a `readonly` field is a silent no-op at run time: the engine strips the field and the step reports success. A flow write was already refused for it. The reverse order was not: the flow went live while the field was writable, then the object made it readonly, and the object published clean.

- The `validateReadonlyFlowWrites` member of the reference-integrity suite now judges `object` writes as well as `flow` writes (`flow-update-readonly-field` at `error`, `flow-update-readonly-when-field` at `warning`).
- On an object write the host carries the written package's live flows (`RuntimeStackContext.flows`, a new optional key) as the subjects that rule judges. Flows of other packages are not carried. A flow the same batch redrafts is judged on its own write, not as a subject. The finding is located on the flow by name, e.g. `flows.leave_submit.nodes[1].config.fields.status`.
- The carried flows are judged in a separate subject pass: the gate runs the reference-integrity suite with `subjectPass: true` (new on `AuthoringRuleContext` and `ReferenceIntegrityRunOptions`), and the suite then runs only the members declaring them (`ReferenceIntegrityRule.subjects`, new). `runRuntimeAuthoringRules` gains `subjectObjects`, the objects that pass judges against. Every other rule of the object door judges exactly the snapshot it judged before, so no other refusal or advisory moves.
- A flow write is unchanged: it is handed no flows, and its findings keep the positional `flows[0]` path.
- Cost: one more indexed `sys_metadata` read per object publish (issued together with the four the gate already makes), and on a package publish holding an object draft one draft read per flow draft in the batch; a batch with no object draft reads none. Not measured on a production store.

Migration: before making a field readonly, publish the flow that writes it with `runAs: 'system'` (a button or action starts an elevated flow only as a `screen` or `api` flow, or through a `subflow` node), remove the field from the flow's node, or keep the field writable.

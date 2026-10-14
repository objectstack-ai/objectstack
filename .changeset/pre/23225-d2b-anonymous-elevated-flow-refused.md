---
'@objectstack/spec': minor
'@objectstack/metadata': minor
'@objectstack/metadata-protocol': minor
---

feat(spec)!: publish refuses an anonymous flow endpoint whose target flow runs as `system`, in both directions, with the prescription (ADR-0138 D2b)

Clause-②: yes (narrowing)

<!-- adr-0087: registered api-endpoint-anonymous-elevated-flow-refused -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `minor` under the launch-window convention for breaking changes.

ADR-0138 D2b decides that no anonymous door triggers an elevated flow directly. An `authRequired: false` endpoint of `type: 'flow'` whose `target` flow declares `runAs: 'system'` ran every anonymous request's data steps as the system principal, past row-level security, with the endpoint's rate limit as the only brake. The runtime's own elevated-start refusal covers only self-triggered flow types (`autolaunched`, `record_change`, `schedule`), so a `system` flow of type `api` or `screen` behind such an endpoint executed elevated. Publish now refuses the pair, in both directions, because either item can be the last one edited: the endpoint's publish reads its target's `runAs`, and a flow's publish that sets `runAs: 'system'` reads the anonymous endpoints that target it. Each refusal names the endpoint and the flow and carries the prescription.

**What is refused, and where.** Every publish door that holds the pair calls one judge, `anonymousElevatedFlowPairs` in `@objectstack/spec/api`:

- **The stack parse** (`defineStack`, `objectstack validate`, `objectstack build`, the artifact load): a stack whose anonymous flow endpoint names one of its own flows declaring `runAs: 'system'`. One zod issue per pair, `code: 'custom'` at `apis[i].authRequired`; `defineStack` throws its schema refusal, `STACK_SCHEMA_INVALID` (422), carrying the issue.
- **The package publish** (`MetadataManager.publishPackage`, `POST /api/v1/packages/:id/publish`): an `api` item of the package naming a `system` flow anywhere in the manager's index, reported at the endpoint; and a `flow` item of the package declaring `runAs: 'system'` that an anonymous endpoint outside the package names, reported at the flow. The package publishes nothing (`success: false`, the pair in `validationErrors`), and `validate: false` does not turn it off.
- **A flow published through the metadata API** (`saveMetaItem` in publish mode, so `PUT /api/v1/meta/flow/:name`; a draft's publish, `POST /api/v1/meta/flow/:name/publish`; and `POST /api/v1/packages/:id/publish-drafts`): a flow going `active` with `runAs: 'system'` while a declared anonymous flow endpoint names it. `INVALID_METADATA` (422), `issues[0].path: 'runAs'`, nothing written; a publish-drafts batch aborts on it. A draft save is not judged (a draft does not execute; its publish is), and neither is a `migrate-stored` re-save of a row that already exists.

**Unchanged.** Each item alone publishes as before: an authenticated endpoint on a `system` flow, an anonymous endpoint on a `user` flow (or one that leaves `runAs` at its default), and an anonymous `object_operation` endpoint are all accepted. A stored flow row that already pairs this way keeps its bytes and keeps executing as published; its next publish is refused. A guest-written row that fires a record-change flow is outside the refusal: the record leaves that indirect path undecided, because its trigger is the write, not the door.

## FROM → TO

| door | FROM | TO |
|:--|:--|:--|
| `defineStack` / `objectstack validate` | `apis: [{ name: 'acme_intake_api', type: 'flow', target: 'acme_intake', authRequired: false, rateLimit: { enabled: true, windowMs: 60000, maxRequests: 100 }, … }]` beside `flows: [{ name: 'acme_intake', runAs: 'system', … }]` accepted; every anonymous request ran `acme_intake` as the system principal | refused, `STACK_SCHEMA_INVALID` 422, the issue at `apis[0].authRequired` naming both items and the prescription |
| package publish | a package carrying either half of the pair, with the other half anywhere in the manager's index, published | refused, `success: false`, the pair reported at the package's own item |
| metadata API flow publish | `PUT /api/v1/meta/flow/acme_intake` with `runAs: 'system'` while an anonymous endpoint names it saved and armed it | refused, `INVALID_METADATA` 422, the issue at `runAs`, nothing written |

**The one-line fix: serve the caller another way — an authenticated endpoint (`authRequired: true`) for a partner that can hold a credential, the flow's signed inbound hook (ADR-0041: a start node with `triggerType: 'api'`, a `hookId` and a `secret`, which may keep `runAs: 'system'`) for a partner webhook, or a public form (a form view whose `sharing` sets `allowAnonymous: true`) for anonymous intake.** `runAs: 'automation'` joins that list when ADR-0073 M2 adds the value.

No D2 conversion rewrites it: which channel replaces the anonymous endpoint depends on who the caller is, and whether the flow needs elevation is a judgment about its data steps, so no conversion can choose a posture for the author. Its D3 record is the semantic entry `api-endpoint-anonymous-elevated-flow-refused` (protocol 18).

**`@objectstack/spec`.** The judge and its two refusal sentences join `@objectstack/spec/api`: `anonymousElevatedFlowPairs`, `anonymousFlowDoorTarget`, `anonymousEndpointElevatedFlowMessage` (the endpoint direction), `elevatedFlowAnonymousEndpointsMessage` (the flow direction) and `validateAnonymousElevatedFlows` (the stack's issues), with the types `AnonymousFlowDoorCandidate`, `ElevatedFlowCandidate` and `AnonymousElevatedFlowPair`. `ObjectStackDefinitionSchema` runs the judge beside the per-endpoint gates. The `runAs` description on the flow schema, which prescribed `system` for every user-less trigger, `api` included, now names the exception and what serves that caller.

**`@objectstack/metadata`.** `MetadataManager.publishPackage` runs the judge over the package's `api` and `flow` items against the index the endpoint matcher serves from.

**`@objectstack/metadata-protocol`.** The flow publish doors run the judge against the declared endpoints: the engine registry's `api` items and the `metadata` service's.

**Who is affected, measured.** No in-repository stack pairs an anonymous flow endpoint with a `system` flow: `examples/` declares no `authRequired: false` endpoint, and every anonymous flow endpoint in the test fixtures names a `runAs: 'user'` flow. The partner-webhook example, `showcase_inbound_task_webhook`, takes the signed inbound hook with `runAs: 'system'` and is untouched.

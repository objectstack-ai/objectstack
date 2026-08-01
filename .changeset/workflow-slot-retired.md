---
"@objectstack/spec": major
"@objectstack/client": major
"@objectstack/metadata-protocol": minor
"@objectstack/runtime": minor
---

refactor(spec,client,metadata-protocol,runtime)!: retire the workflow service slot — declared end to end, implemented nowhere (#4451)

The `workflow` slot was ADR-0078's silently-inert declaration at every layer at
once: a `CoreServiceName` nothing ever registered or resolved (ADR-0115
Evidence 5 — "no code in this repository resolves either slot", verified across
both repositories), an `IWorkflowService` contract with zero implementations, a
`WorkflowProtocol` whose three methods no code ever provided, a discovery
`routes.workflow` field no builder could truthfully populate, and a
`/api/v1/workflow` advertisement for a path no host ever mounted (the
pre-#3586 `DEFAULT_DISPATCHER_ROUTES` already listed it among routes that
never existed). The capability it promised is live elsewhere and has been for
majors: record state machines are enforced by the `state_machine` validation
rule, approvals are first-class flow nodes on the approvals runtime
(ADR-0019), and record-triggered automation is lifecycle hooks +
`record_change` flows (`service-automation`).

FROM → TO:

- `CoreServiceName 'workflow'` / `ServiceRequirementDef.workflow` /
  `CORE_SERVICE_PROVIDER['workflow']` → removed; there is no slot to fill.
- `IWorkflowService` (`@objectstack/spec/contracts`) → removed; no
  implementation ever existed. Register nothing — use the mechanisms above.
- `WorkflowProtocol` + `GetWorkflowConfigRequest/Response`,
  `WorkflowState`, `GetWorkflowStateRequest/Response`,
  `WorkflowTransitionRequest/Response` (`@objectstack/spec/api`) → removed,
  along with the seven published JSON schemas. Delete the import; nothing
  ever answered these shapes.
- Discovery `routes.workflow` / `services.workflow` / `features.workflow`
  (metadata-protocol + runtime builders) → absent. A reader keying on them
  only ever saw `unavailable` / `false`; delete the read.
- `RouterConfig.mounts.workflow` → removed; there was never a surface to
  mount at it.
- `RestApiRouteCategory 'workflow'` → removed; categorize automation-adjacent
  routes as `'automation'`.
- `@objectstack/client` re-exports of the four workflow types → removed with
  their source. (The `client.workflow.*` methods were already removed earlier
  in the v17 cycle — this retires the types they returned.)
- Also removed: the stray `graphql` entry in `CORE_SERVICE_PROVIDER` and the
  `graphql: { route: '/graphql' }` discovery entry — `graphql` was never a
  `CoreServiceName`, and the dispatcher had already dropped `/graphql` as out
  of the product plan (#2462 follow-on).

The retirement kit: the `workflow-service-slot-retired` semantic migration
(major 17) carries this prescription into `spec-changes.json`, the generated
upgrade guide and the `spec_changes` MCP tool. These are TS/API surfaces and a
discovery response field — never stored in stack metadata — so there is no
load-path conversion and nothing for `os migrate meta` to rewrite; the
21 `authorable-surface.json` baseline lines and 7 `json-schema.manifest.json`
entries for the deleted schemas are dropped deliberately in the same change
(the plugin-runtime precedent: a prescription nobody can receive is noise —
nothing parses these shapes any more).

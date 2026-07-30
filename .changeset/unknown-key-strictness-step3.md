---
"@objectstack/spec": major
---

feat(spec)!: reject unknown keys on the approval authoring schemas (#4001 step 3)

Third click of the unknown-key strictness ratchet (flow + permission in
#4071, RLS / sharing / position in #4099). Approval is a v17-new authoring
surface — tightened while young, before stored volume exists:

- **`automation/approval.zod.ts`** — `ApprovalNodeConfigSchema`,
  `ApprovalNodeApproverSchema`, `ApprovalEscalationSchema`, and
  `DecisionOutputDefSchema` are `.strict()` with fixable errors. An approval
  gate that quietly ignores half its config is the worst instance of the
  ADR-0078 trap — the request routes, but not the way the author declared.
- The published JSON schema (`getApprovalNodeConfigJsonSchema`) now carries
  `additionalProperties: false` into the Studio property form AND
  `registerFlow()`'s per-node config validation (#4027/#4040), so an unknown
  key inside an approval node's `config` is rejected at registration too.

**Migration.** Any key now rejected was previously stripped and had no
runtime effect — removing or renaming it never changes behavior. Mappings
baked into the errors include the ADR-0019 re-home map for process-era
concepts: `steps` → successive approval NODES on the canvas, `entryCriteria`
→ the condition on the entering edge, `onApprove` / `onReject` → the nodes
wired to the `approve` / `reject` out-edges, `rejectionBehavior` → a declared
back-edge (ADR-0044) with `maxRevisions`. Plus spelling aliases:
`mode` / `approvalMode` → `behavior`, `quorum` → `minApprovals`,
`statusField` → `approvalStatusField`, `org` → `organization`,
`expandAs` → `resolveAs`, `timeout` / `hours` / `sla` → `timeoutHours`,
`to` / `target` → `escalateTo`, `name` → `key`, `widget` → `type`.

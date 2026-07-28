---
"@objectstack/plugin-approvals": minor
"@objectstack/spec": minor
"@objectstack/lint": minor
---

feat(approvals): cross-organization approver targeting — a plant document can
require a group-side sign-off (ADR-0105 D9)

One organization id used to decide three different things at once in
`openNodeRequest`: where the request row lives, where its inbox index rows
live, and **where its approvers are looked up**. The first two are the
request's own organization by definition. The third is not — a group CFO holds
her `cfo` position in the GROUP organization while the purchase order she signs
off lives in the PLANT organization. `expandPositionUsers('cfo', <plant>)`
matched nobody, the slot fell back to the dead `position:cfo` literal, and a
group escalation could not be expressed at all.

An approver may now declare which organization's directory resolves it:

```yaml
approvers:
  - { type: position, value: plant_manager, group: plant }
  - { type: position, value: cfo, organization: $root, group: finance }
behavior: per_group
```

- **`$root` / `$parent`** walk D6's `parent_organization_id` tree, so the two
  common intents need **no deployment knowledge** — flow metadata is portable
  across environments while organization ids are minted per deployment. A slug
  covers what the symbols cannot, notably a **sibling** organization (a
  shared-services centre approving payables for every plant).
- Declared **per approver**, so one node can require a plant manager and a
  group CFO in parallel. A node-level form cannot express that without
  splitting into serial nodes, which changes the semantics.
- **Bounded, not free:** the target must share a `parent_organization_id` root
  with the request's organization. The rule reads only the organization tree —
  never the submitter — so one flow routes identically for everyone.

Everything else fails loudly rather than quietly:

- a non-`group` posture **refuses** the declaration (a `group` → `isolated`
  migration must not silently reroute approvals);
- an approver type with no org-scoped directory (`user` / `field` / `manager` /
  `team`) refuses it too, and a new `approval-approver-cross-org-unsupported`
  lint catches that at author time;
- a targeted approver holding no membership in the request's organization is
  dropped with a warning naming them — D2's union wall would otherwise hide the
  request from someone already routed to, so the node's existing
  `onEmptyApprovers` policy takes over instead of leaving an unopenable task.

Nothing changes for an approver without `organization`: same resolution, same
queries, no extra reads.

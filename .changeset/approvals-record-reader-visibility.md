---
"@objectstack/plugin-approvals": minor
---

feat(approvals): read-only approval visibility for users who can read the target record, per object, default OFF (#8652)

A new `ApprovalsPluginOptions.recordReaderVisibleObjects` names the objects on
which **a user who can READ a business record may also see that record's
approval requests and full action history** — read-only. Omitted or empty (the
default) leaves visibility exactly as it is today, so an existing deployment
sees no behaviour change on upgrade. **This is not a no-op change**: on an
object you list, a population that could previously see nothing gains a real
read.

```ts
new ApprovalsServicePlugin({ recordReaderVisibleObjects: ['exam_sheet'] })
```

**Who gains visibility.** Until now the visible set was submitter ∪ current
approver ∪ historical actor, with a platform/tenant admin override as the only
bypass — so a ledger or supervisor role that holds full read on the record but
never appears in the approval itself received `200` with an empty list, and the
Console's approval tab never rendered. On an enabled object, that role now sees
the record's approvals.

**What becomes visible on an enabled object**, stated plainly because the switch
is an opt-in decision about confidentiality:

- the approval request row, including its `payload` snapshot of the record as it
  stood at submission time;
- the full action history — each actor, their decision, the timestamp, **and the
  action's comment text** (意见正文);
- decision attachments on those actions, which are gated on the same rule.

Enable it on objects whose approval commentary the record's readers are meant to
see; the comment text is often evaluative, and it is per object precisely so
that enabling it for a ledger object does not enable it for anything else.

**What does NOT change.**

- **Read-only.** No approval action is delivered through this tier. Approve,
  reject, reassign, recall and comment keep authorizing exactly as before — on
  the pending-approver slate, the submitter, or admin override — and a viewer
  admitted by this tier gets `can_act: false`. Seeing a request confers nothing.
- **No new permission concept.** The tier is anchored on the existing
  record-read permission: the service asks the engine to read the record **as
  the caller**, so ordinary object CRUD and RLS decide. No new role, grant type
  or policy, and no host-injected visibility hook — a security predicate the
  platform can neither constrain nor audit was considered and rejected.
- **The inbox.** An untargeted list is unchanged. The rule is anchored on one
  record, so it applies only where a record is named — a list filtered by
  `object` + `recordId` (what a record page's approval tab sends), or a request
  loaded by id. A work queue does not become a browse surface.
- **Tenant isolation, and everything else about the existing visible set.** The
  tier only ever adds ids to the participant set; it can never return the "sees
  everything" verdict and never relaxes an existing constraint.

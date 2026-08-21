---
"@objectstack/plugin-approvals": minor
---

fix(approvals): screen the `manager` approver to the request's organization (#10153)

`expandApprovers` hands the directory organization to every graph-shaped
approver expansion — `department`, `position`, `org_membership_level`. The
`manager` branch did not: `lookupManager` read `sys_user.manager_id` under a
system context and took no organization argument at all. `sys_user` is a global
identity table with no `organization_id`, so nothing else on that path supplied
the tenancy fact either. A `manager_id` crossing an organization boundary
therefore routed the submission to an approver **in another organization** — an
out-of-tenant person granted approval authority over the record.

The same column has been screened on the hierarchy side since cloud#1195. This
brings the approvals consumer into line for the `manager` branch.

## What the screen is

`lookupManager(userId, organizationId)` now resolves the manager and then asks
whether he is **provably outside** the request's organization:

| membership rows for the manager | result |
|---|---|
| some exist, none in the request's org | **screened out** — the slot falls through to the `manager:<value>` literal |
| one is in the request's org | resolves, unchanged |
| none exist at all | resolves, unchanged — the tenancy fact is absent, not negative |
| the `sys_member` read failed | resolves, unchanged |
| the request carries no organization | resolves, unchanged — and no read is performed |

The fail-open half is this file's ruled posture on addressing paths, stated
twice already: `filterApproversWhoCanRead` refuses to empty a live slate on an
infrastructure hiccup, and `expandPositionUsers` carries "a step routing to
nobody is worse than one routing to a lapsed holder". A drop is logged with the
manager's id, his organizations and the request's, so the fix ("repair the link"
/ "grant the membership" / "retarget the step") is legible without a debugger.

## ⚠️ This moves one input from accepted to refused

A node whose **sole** approver is a cross-org `manager` and which is authored
with the **non-default** `onEmptyApprovers: 'fail'` used to open successfully;
it now throws `NO_APPROVERS`. Nothing new is thrown — a screened-out manager
leaves only a `type:value` literal, which the pre-existing empty-slate test
already classifies as empty, and `'fail'` already throws on empty. Every
screened sibling has reached that same bucket since it was written.

**The default policy is unaffected**: `admin_rescue` still opens the request
(decidable by a privileged admin) and warns, and `auto_approve` still
auto-approves. Both directions and both policies are pinned in
`manager-approver-org-screen.test.ts`.

## What this does NOT decide

- **#7497** (does approver routing imply record read visibility?) stays open.
  The screen reads `sys_member`, which looks like the D2 read filter beside it,
  and the code says at length why it is the *sibling* treatment instead: two of
  the three org-scoped expansions already screen on `sys_member.organization_id`,
  and `sys_user` offers no other tenancy fact. No reads are granted and no read
  screen is applied to any type that lacked one.
- **`team`** is still unscreened — it is a sibling graph expansion that is not
  org-scoped either, tracked as #10230, and it touches this same file.
- `APPROVER_ORG_SCOPED` is untouched. It answers ADR-0105 D9 *retargetability*
  (may an author write `organization:` on this type?), not screening, and
  `manager: false` remains correct.

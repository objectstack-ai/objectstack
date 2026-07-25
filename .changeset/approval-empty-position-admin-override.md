---
"@objectstack/plugin-approvals": patch
"@objectstack/spec": patch
---

fix(approvals): admin override for a request routed to an unstaffed approver (#3424)

An `approval` node routed to a `position` (or `team`/`department`) with **no
holders** resolved to only the unresolvable `position:<name>` literal in
`pending_approvers` — no concrete user was in the slate. Every normal
`decide` / `reassign` / `recall` then returned `FORBIDDEN` (not a pending
approver) and, with `lockRecord`, the target record stayed `RECORD_LOCKED`
forever: a data-availability dead-end with no in-product recovery (the only exit
was editing the DB by hand). Very easy to hit in fresh/demo orgs (positions
seeded, holders not) and whenever a role is vacated in production.

A **platform or tenant admin** — the same posture the engine's superuser bypass
already trusts — may now act on any *pending* request to release it: **approve,
reject, reassign** it to a real approver, or **recall** it. The override finalizes
the request (which releases the record lock, keyed on a pending request); a
tenant admin's authority is org-scoped, a platform admin's is not, and the
decision is audited under the admin's own id. An admin approval is authoritative,
finalizing the node even under `unanimous` / `quorum` / `per_group` rather than
counting as one vote among the (empty) slate.

- `sys_approval_request.viewer` gains `can_override` (server-computed): true for a
  privileged admin on a pending request. The `approve` / `reject` / `reassign`
  declared actions OR it into their `visible` gate, so the console surfaces the
  recovery path without a hand-wired button. Existing approver/submitter gating is
  unchanged.
- `openNodeRequest` now logs a loud warning when a node resolves to **no concrete
  approver**, so the misconfiguration is visible instead of silently locking the
  record. The literal-fallback behavior (kept for 15.x slot back-compat) is
  otherwise unchanged.

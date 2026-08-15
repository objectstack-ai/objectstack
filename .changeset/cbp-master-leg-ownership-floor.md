---
"@objectstack/plugin-security": patch
---

fix(security): `controlled_by_parent` detail writes compose the master's ownership floor the same way a direct write does (#8865)

**This change widens a permission boundary, deliberately and with maintainer
approval (ruling of 2026-08-15, direction 1): children of a master become
writable by every principal whose record-sharing verdict on that master is
`allow`.** That is the same set which already reaches the master itself — the
widening restores a symmetry the platform declares, it does not mint a new
capability — but it is a real widening and it is stated here rather than
softened.

## What was measured

`assertControlledByParentWrite` (ADR-0055, step 2.8) resolves master-edit access
in two legs. Leg 1 — the master's own write RLS — computed
`computeRlsFilter(master, 'update')` with **no** `dropPlatformOwnershipFloor`,
while the by-id write pre-image gate (step 2.7) computes the same filter for the
same object with that knob set whenever `ISharingService` answers `allow`. So the
platform's ownership floor (`created_by == current_user.id`, shipped by
`member_default`) was dropped on the direct path and left standing on the derived
one, and one principal, one master row and one `update` got two answers:

| step | verdict before |
|---|---|
| PATCH the master `camp_mkt` directly, by id | allowed |
| UPDATE a child of `camp_mkt` | `403 … requires edit access to its master record (master 'crm_campaign' not editable by this user (row-level security))` |

The principal in that measurement holds `modifyAllRecords` on the master, which
is exactly what makes the sharing verdict `allow` and drops the floor on the
direct path; it did not create the master, so the undropped floor refused it on
the derived path. Every widening mechanism the platform declares — ownership at
write DEPTH, an `edit`-level `sys_record_share`, `modifyAllRecords` — was
therefore inert **for children** while it worked **for the master itself**. An
app author saw a master they could edit and children they could not.

This is the divergence #8679 closed in leg 2 (record sharing), surviving one leg
over, and it is closed the same way: one principal, one row, one operation must
not get two answers.

## The change

Leg 1 adopts step 2.7's composition, clause for clause:

- ask `resolveSharingWriteVerdict('update', master, masterId, …)` — the tri-state
  verdict, not `canEdit`'s boolean projection — and drop the platform ownership
  floor **only** on `allow`;
- ask it only when a platform floor policy is actually applicable to this
  (principal, master, `update`), so an object with no floor in play spends no
  sharing probe;
- `abstain` and `deny` both leave the floor standing, and the verdict answers
  `deny` when its own probe throws, so no failure mode of this composition can
  widen;
- the on-behalf-of path (ADR-0090 D10) is excluded, mirroring step 2.7: a
  delegated write keeps **both** principals' floors, exactly as before.

Only the PLATFORM's floor is droppable (provenance, ADR-0105 D3). An app-authored
policy — including one spelling the identical predicate — reaches the compiler
untouched and still refuses (ADR-0049), and Layer 0 (the tenant wall) is not
affected at all. Step 2.7's composition and the insert leg's #8688 stand-down are
untouched.

## Pinned

The residual assertion the measuring run left in the tree
(`controlled-by-parent-detail-write-authority.test.ts`, labelled `RESIDUAL
(#8865)` with the comment "When #8865 lands the assertion above flips") now
asserts the permission, and keeps its witness — the same principal, the same
master row, the same operation, asked directly — so the two paths cannot drift
apart again without a red.

A new section pins the flip to the composition rather than to a relaxation, each
case varying one input and asserting the direct write of the master agrees:

- an `edit`-level `sys_record_share` on the master — and nothing else — is what
  moves a child write from refused to permitted;
- an owner-less master, where `checkEdit` abstains for everyone (Modify All Data
  included), keeps its floor and refuses on both paths — the case that separates
  the ruled `=== 'allow'` composition from the boolean projection;
- an app-authored master policy still refuses a principal whose sharing verdict
  is `allow`, while the same write without that policy is permitted.

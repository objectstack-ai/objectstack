---
"@objectstack/spec": minor
"@objectstack/plugin-approvals": patch
---

fix(spec,plugin-approvals): the two approval vocabularies are derived, not hand-matched (#3786)

`sys_approval_request.status` and `sys_approval_action.action` spelled their
option lists out — five values and twelve — each under a "Keep in sync with
`ApprovalStatus` / `ApprovalActionKind` (spec/contracts)" comment, while the
contract held the same sets as bare type unions. Seventeen strings matched by
hand across a package boundary, with nothing checking them. They did all still
agree; the sweep that found them (#3786) verified that verbatim before changing
anything.

Agreeing is not the same as being held, and both directions of drift are quiet:

- a value the **column** accepts and the contract omits is invisible to every
  consumer typed against the contract — the row exists and nothing can narrow it;
- a value the **contract** declares and the column rejects surfaces only at write
  time, on whichever tenant first reaches that transition.

An audit vocabulary is a bad place for either. So the contract now publishes the
lists as values — `APPROVAL_STATUSES` and `APPROVAL_ACTION_KINDS` — with
`ApprovalStatus` / `ApprovalActionKind` derived from them via
`(typeof X)[number]`, and the two columns spread the constants. The per-entry
rationale (which action kinds move the flow, which are thread-only, why
`returned` differs from `recalled`) moved onto the constants, where the values
live.

**New exports, no behaviour change.** The emitted option lists are byte-identical
— verified against the built artifact before and after. Existing imports of the
two types are unaffected; the types resolve to the same unions.

`approval-vocabularies.test.ts` pins the qualifier that derivation alone cannot:
the columns agree with the contract *while the spread is there*, and the test
fails if either is re-inlined as a literal that has drifted. It also guards the
guard (an unresolvable import would compare two empty lists and pass) and asserts
the two vocabularies stay distinct, since a copy-paste pointing one column at the
other constant would satisfy "derived from the contract" while being the wrong
vocabulary entirely.

Verified by mutation in both directions: adding a value to `APPROVAL_STATUSES`
propagates into the built `sys_approval_request.status` options (the derivation
is live, not a stale build), and re-inlining a drifted literal fails
`sys_approval_request.status offers exactly the contract statuses, in order`.

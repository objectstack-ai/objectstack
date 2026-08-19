---
"@objectstack/objectql": patch
---

fix(engine): the required-FK escalation on a `multiple: true` lookup is judged per ROW — a parent delete is refused only over the rows member removal would EMPTY (#9688)

`cascadeDeleteRelations` escalated `set_null` → `restrict` on `fdef.required === true`
before the multi-value branch and before the dependents probe had run, so a delete was
refused for every row that referenced the record, whatever else that row's set held.
Measured with a real engine + stub driver: a child holding `accounts: [acct_a, acct_b]`
on a `required: true, multiple: true` lookup refused `DELETE acct_a` with
`DELETE_RESTRICTED` / 409 / `dependentCount: 1`, leaving the set untouched.

**The escalation's own rationale is what bounds it.** It exists because clearing a
required foreign key issues an UPDATE the child's validator rejects with a misleading
`"<field> is required"` 400. On a `multiple: true` field the `set_null` limb does not
clear the slot — since #9438 it removes the deleted MEMBER and writes the remainder — so
that failure is only reachable for a row the removal would EMPTY. Removing `acct_a`
above writes `[acct_b]`, a non-empty required set no validator objects to; the delete was
refused citing a failure that could not have happened.

**Now decided per row, after the dependents probe and the exact multi-value narrowing:**

- remainder non-empty → the member is removed and the delete proceeds (#9438 semantics,
  which the #9447 ruling accepts);
- remainder empty (the deleted member was the last) → `DELETE_RESTRICTED` stands, because
  `[]` violates `required` on a multi-value field under #9447 and is rejected by the
  record validator since #9476;
- when both kinds of row reference the record the whole delete is refused, and
  `dependentCount` now counts **only the rows that would be emptied** — previously it
  counted every referencing row, naming rows the delete no longer objects to.

The judgement and the write share one function (`remainderAfterMemberRemoval`), so the
predicate that clears the write can never predict a shape the write would not produce.

**Unchanged:** single-valued `set_null` on a required lookup still escalates (clearing a
scalar FK always writes `null`), an authored `deleteBehavior: 'restrict'` still refuses
regardless of emptiness, `cascade` is untouched, and a non-required multi-value lookup
keeps removing the member as before.

The #9625 fixture pinning the previous, broader refusal is updated deliberately rather
than repaired — that is what it was pinned for — and the last-member refusal is pinned
beside it, since that pin is what makes the narrowing safe. Also pinned: the defaulted
`set_null` spelling reaches the same per-row judgement as the explicit one, an authored
`restrict` is not narrowed, and `dependentCount` reports the refused rows only.

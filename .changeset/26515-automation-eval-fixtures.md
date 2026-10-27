---
'@objectstack/skills': patch
---

fix(skills): objectstack-automation eval fixtures 5, 7 and 8 agree with their own assertions

Clause-②: no
Metadata-protocol: none

- **Before.** Three ideal answers in `evals/flows-triggers-approvals.json` failed the assertions that grade them: eval 5 spelled the negated error-label string inside its answer, eval 7 never spelled the `type: 'position'` approver it requires and spelled the negated positions check, eval 8 never spelled the `type: 'screen'` flow kind it requires. Graded against those assertions, a correct answer scored wrong.
- **Now.** The three ideal answers say each negation in words, eval 7 names `approvers: [{ type: 'position', value: 'finance_manager' }]`, and eval 8 opens with the flow kind. No fixture added or removed; the assertions and the skill's teaching are unchanged.
- No schema, key or behaviour changes.

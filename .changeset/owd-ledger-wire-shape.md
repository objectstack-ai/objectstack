---
'@objectstack/runtime': patch
---

Correct the `owd_widening_forbidden` rationale in the dispatcher error-code ledger to the measured wire shape.

The row's `why` claimed the refusal "reaches the wire verbatim" in a 403 body "whose `code` is this string". Since #9232 narrowed the flat REST door, it does not: the body carries `code: PERMISSION_DENIED` — the closed ADR-0112 member the status derives — and the gate's own lowercase spelling rides the open `declaredCode` sibling beside it, which is what `packages/rest/src/meta-object-owd-gate.test.ts` actually asserts. Prose only; the `pending-registration` verdict, the accept/reject set and every emitted body are unchanged.

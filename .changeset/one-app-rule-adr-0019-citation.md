---
"@objectstack/spec": patch
---

fix(spec): the one-app-per-package refusal cites the record it means, `ADR-0019 (app-as-consumer-unit) D3`

`ADR-0019` names **two** records in this repository — `0019-app-as-consumer-unit` (D3 = a `type: 'app'` package defines at most one app) and `0019-approval-as-flow-node` (D3 = deprecating `ApprovalProcessSchema`). Both have a D3, and `stack.zod.ts` cited the bare number for both, so an author following the refusal's own citation was as likely to reach the wrong decision record as the right one.

The three citations of the app-cap rule now name the record:

- the `STACK_SINGLE_APP_VIOLATION` message — the only one an app author ever sees;
- the `validateSingleApp` docblock;
- the `StackSingleAppViolationError` docblock.

Only the message tail changed: `An 'app' package must define at most one app, but found N (…)` is untouched, so any consumer matching on that prefix is unaffected. The rule, the refusal's condition and `defineStack`'s behaviour are unchanged.

The approvals-side citations are deliberately left bare — repo-wide ADR-number disambiguation is tracked separately.

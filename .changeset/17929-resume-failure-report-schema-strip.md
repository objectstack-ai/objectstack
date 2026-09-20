---
'@objectstack/spec': patch
---

`ResumeFailureReport`'s docblock no longer invites a caller to parse that member with `ResumeFailureDetailsSchema` — the one path that deletes the report's `code`, silently.

The docblock said two things in one paragraph: that a caller "that parses this member with `ResumeFailureDetailsSchema` reads the same three facts it reads off that door", and that `code` is the one member a success envelope cannot leave to its envelope, because on a success answer nothing else names the failure class. Each sentence is true on its own; together they route a reader into losing exactly the member the second one calls indispensable. `ResumeFailureDetailsSchema` declares `runId` / `status` / `repairable` and not `code`, and it is a plain non-strict `z.object`, so the key is stripped — measured on this tree, `safeParse` of a full report answers `success: true` with `error: undefined` and hands back an object with no `code` at all. No refusal, no `unrecognized_keys` issue, nothing logged.

- **Prose only — no schema moves, deliberately.** `ResumeFailureDetailsSchema` is the wire schema of the automation resume door's `400 FLOW_FAILED` `error.details`, where the registered code rides on the `error` envelope it is parsed beside. Declaring `code` on it would put a second spelling of the failure class on that door's answer, widen a published accept surface, and break the "declared ONCE" identity the contract pin asserts — the report minus its `code` IS `ResumeFailureDetails`. The defect is in the sentence that misdirects, not in the schema, which is correct where it is actually used.
- **What a consumer does instead:** read `code` off the report. It is typed `ErrorCode`, required, and needs no parse. That schema stays the right reader for the three shared members, and the right reader on the resume door.
- **Both halves are pinned** in `contracts/resume-failure-report.pin.test.ts`: that the strip is silent (parse succeeds, no issue raised, no `code` in the output), and that the docblock carries the warning and no longer carries the invitation. Prose is unassertable except by reading it, so the contract source is read — the pattern that file already uses for the absence rule.

Clause-②: no

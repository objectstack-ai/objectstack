---
"@objectstack/spec": minor
---

`@objectstack/plugin-approvals` is now registered as a second emitter of the already-registered `RESUME_FAILED` in `ERROR_CODE_LEDGER`, so the only correct implementation of `ResumeFailureReport.code` stops being refused by `check:error-code-provenance`.

**The contradiction this closes.** `ResumeFailureReport` (`contracts/approval-service.ts`) declares `code: ErrorCode` as **required** — "a success answer has no envelope `code` to fall back on" — and its docblock prescribes `RESUME_FAILED` for a run that could not be advanced. But the ledger listed that code only under `@objectstack/rest`, so the first producer to fill the slot stamped a registered code its own owner key did not list, which the provenance gate refuses. The declaration shipped in a state where satisfying it tripped a sibling gate.

**Measured, not derived.** With PR #17908's stamp site present and the ledger unchanged, the guard answers exit 1 and names it: `@objectstack/plugin-approvals stamps 'RESUME_FAILED' (objlit) at packages/plugins/plugin-approvals/src/approval-service.ts:3370 — not listed under its own owner key`. With this row, the same tree answers exit 0 with the site counted as listed.

**A row, not a waiver — the precedent's own predicate decides it.** The `EXTERNAL_IMPORT_ERROR` waiver records "the door stamps this code itself for every throw and never reads the producer's declaration". Both halves fail for `resumeFailure`: it rides a **success** answer, which the REST approvals door serves with `res.json(out)` verbatim, and `packages/rest/src` spells `resumeFailure` nowhere. The producer's literal *is* the wire value, so the door names no vocabulary to waive it under.

**One code, not the three the docblock names.** `RESUME_TARGET_LOST` is a thrown message prefix mapped by rest's catch and stays under rest's row; `RESUME_IN_PROGRESS` is compared and never constructed in this package, and is emitted by `@objectstack/service-automation`, which carries its own row. A row for a code the package does not stamp would be the dead weight this file's gate refuses.

⛔ **No wire byte moves and no accept set widens.** `RESUME_FAILED` was already in the registered union, so no response can now carry a code it could not carry before; the per-package rows are provenance, not identity. No exported symbol is added and no published payload gains a key.

---
"@objectstack/spec": patch
---

fix(spec): the three shipped confirmation-gate prescriptions state the gate in the present tense — they were denying a door that exists (#17487)

Clause-②: no

No accept-set change and no export moves. `ToolSchema` still refuses
`requiresConfirmation` with a located parse error, `ActionSchema` still accepts
`ai.requiresConfirmation` in both directions, and `check:authorable-surface` /
`check:api-surface` are byte-identical across this diff. What moves is text.

Three customer-facing prescriptions were written while the runtime confirmation
door was a separate, unlanded change, and each said so in the present tense. The
door has since landed on `main` — `actionConfirmationRefusal`, called pre-dispatch
by `invokeBusinessAction` in `@objectstack/runtime`, with the `confirm` member
grown on the MCP `run_action` tool in the same change. From that moment the
published prose DENIED a door that exists, and it denied it in the dangerous direction: an author who
reads it concludes the safety flag stops nothing and either arranges a human in
the loop some other way or stops setting the flag — losing the gate exactly when
it starts working. That is the ADR-0049 false-compliance defect with the sign
flipped.

**The three carriers**, all of them shipped text rather than comments:

1. the `requiresConfirmation` entry of `TOOL_RETIRED_KEY_GUIDANCE`
   (`ai/tool.zod.ts`), which reaches consumers as the parse error on the
   `.strict()` `ToolSchema` — the one channel every consumer bumping
   `@objectstack/spec` is guaranteed to hit;
2. the ADR-0087 D3 entry's `replacement`, and
3. its `acceptanceCriteria` — what `spec-changes.json`,
   `docs/protocol-upgrade-guide.md` and `os migrate meta` project to consumers.

FROM → TO, on the sharpest of the three (the acceptance criterion):

```
was:  Do NOT try to "prove the gate" by invoking the operation without the
      confirmation member: ... before that ships the call is not refused, it
      RUNS the destructive operation.
now:  ... that gate is PERFORMED: invoking the operation over an AI-exposed
      door without the confirmation member is REFUSED with
      ACTION_CONFIRMATION_REQUIRED (428) and nothing runs, so that call is a
      real check you can make rather than a destructive experiment.
```

**The corrections carry the door's BOUNDS, because over-promising here is the
same defect in the other direction.** Each prescription now states, as the door
itself declares them: the refusal is `ACTION_CONFIRMATION_REQUIRED` / 428 naming
the action and the member `confirm: true`; it is a GATE, not a queue — nothing
is parked and a refused call did not run, no record read and none written; the
enforced set is the doors that enforce the author's `ai.exposed` opt-in, today
the action door reached from the MCP `run_action` tool, while REST `/actions` is
not `ai.exposed`-gated and sits outside the gate; only the author's declared
`ai.requiresConfirmation: true` refuses, while the wider listing heuristic
advises and never refuses; and `confirm: true` is an unverifiable caller claim,
so the gate makes FORGETTING loud without proving a human.

`ai/tool-confirmation-prescription-tense.pin.test.ts` is the tie that was
missing the first time: it reads the three shipped strings AND the runtime door,
so a prescription that re-acquires a not-yet-shipped denial fails, and a door
that is removed, narrowed off the DECLARED flag, unhooked from
`invokeBusinessAction`, or widened onto REST `/actions` fails naming both files.
The denial predicate is fed the three retired sentences verbatim, so it cannot
pass by the prose merely falling silent.

**On release ordering.** The door ships in the same release this correction
does: the runtime changeset that carries it (`action-confirmation-gate-enforced`)
is still pending alongside this one, and one `changeset version` run consumes
both. A release cut before this lands is the failure this card exists to end —
the runtime refusing calls while the published spec text tells authors the flag
stops nothing.

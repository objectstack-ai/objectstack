---
"@objectstack/spec": patch
---

docs(spec): the `field.valueDomain` liveness note stops claiming the settings door is "unchanged until then"

The `valueDomain` row of the published `liveness/field.json` ledger ended on a sentence written
while the re-point was still in the future:

> The settings door (`service-settings/value-domains.ts`) re-points onto the shared predicate in
> its own follow-up card and is unchanged until then.

Both halves of the 2026-09-02 ruling have since landed — the settings half (#15434) and the engine
half (#15316) — and the engine half rewrote this note wholesale while carrying that sentence
forward verbatim. "Unchanged until then" therefore described a state that no longer existed: the
door it names had already re-pointed, one commit earlier.

The sentence now says what is true of that door, read off its source rather than off a PR title:
its second copy of all three definitions is deleted, `firstRejectedDomainMember` asks
`isValueDomainMember` — the same call `record-validator.ts` makes — and what remains on that side
is the door's own business (which declarations it agrees to enforce, how a multi-value carrier is
walked, the fragments the env-override log line needs). A re-added local table reddens
`value-domains.shared-predicate.pin.test.ts`.

Ledger-note text only. The row's `status` is untouched — it tracks the engine write path, and
`liveness/state-counts.md` is derived by `gen:liveness-counts` from the row states, none of which
move here (`check:liveness` reports the counts file current).

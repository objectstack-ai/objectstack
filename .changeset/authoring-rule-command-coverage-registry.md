---
"@objectstack/cli": minor
---

fix(cli): every author-time rule that can gate runs on all three commands (#4409)

`os validate`, `os build` and `os lint` each hand-wired their own subset of the
author-time rules. Nothing connected the three lists, so "which rules run here?"
was answerable only by diffing three 800-line files by eye — and the answer
drifted every time a rule landed. The audit found 23 of 26 rules running on some
strict subset, nine of them able to emit `error`.

The worst direction was the least obvious. `os build` — the command that
PUBLISHES — was the weakest gate of the three: a flow whose expression approver
does not parse (`approval-expression-invalid`) built and published green, and
only `os lint` stopped it, while CI usually runs the other two. `os lint`
disagreed in *both* directions at once, running one gating rule neither other
command ran and missing six that both of them ran, which is worse than no
pre-flight — the remaining options are re-verifying everything or learning to
distrust the signal.

This is the same failure mode's fifth appearance (#3583, #3782, #4384/#4394,
#4402). Each earlier repair removed an instance and left the MODE: a rule's
command coverage was whatever its author remembered to type, and forgetting was
silent. #4402's guard could not catch the rest — it filtered on the current
member names of one suite, so a rule hand-wired into two commands from outside
that suite passed it without a word. A name list only guards the names on it.

**The registry.** `AUTHORING_RULES` declares all 26 rules as data: tier
(`gating`/`advisory`), which stack tier they read (pre-parse `normalized` vs
`parsed`), which commands run them, and a written reason for the one narrowing.
All three commands consume it through `runAuthoringRules()`, so adding a rule is
a one-line edit that reaches every command at once. The three command files
shrink by ~1000 lines between them.

**The ratchet.** The wiring guard is no longer a name list: a `gating` rule on
fewer than three commands fails, a narrowed rule with no reason fails, a command
that calls or imports a registry rule directly fails, and an `advisory` claim is
checked against the rule's own source — so a gate cannot wear an advisory label
to buy itself partial coverage. That last check is the one #3760 needed, having
promoted a `lintFlowPatterns` rule from advisory to gating with nothing anywhere
asking whether its coverage should follow. Remaining direct calls are listed
with reasons, and a stale entry fails too, so the ratchet cannot rot into a
permanent permission slip.

**The verdict, not just the wiring.** A separate test plants one defect per
previously-blind gating rule and asserts all three commands gate on it, plus the
issue's own repro driven end-to-end through the real CLI: exit 1 on all three
where it was 1/0/0.

Two behaviour changes fall out of reporting every failing rule in one run
instead of exiting at the first failing gate: an author with three unrelated
problems now sees all three in one pass, and `--strict` covers every advisory
rather than the roughly half that happened to be printed inline.

Also closes the same hole one gate over: `collectAndLintDocs` failed `os build`
and never ran on `os validate`, invisible because the parity guard keyed on the
`lint*`/`validate*` naming convention and that gate is called `collect*`. The
guard now names each shared non-registry gate explicitly instead of
pattern-matching for them.

Cost is not what argued against any of this. The heavy dependencies
(`typescript` ~9 MB, `sucrase`) are already lazy and load only when a stack
carries the metadata that needs them, and the heaviest rule of the set has run
on all three commands as a reference-integrity suite member since #4340 without
anyone noticing. The one narrowed rule, `lintUniqueDeclarations`, is scoped
because `os lint` already reports it through `lintDataModel` — coverage
recorded, not coverage missing.

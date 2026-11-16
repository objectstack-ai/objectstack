---
'@objectstack/scenarios': patch
---

feat(scenarios): a roll-up the build leaves readable over child data the card withholds is a failed Build check

Clause-②: yes (widening) — through `./runner`: the new exports `rollupSourceCharges`, `readRollupSourceFinding`, `RollupSourceCharge` and `RollupSourceReading` (`orchestrate.ts`) and `rollupSourceFindings` and `rollupSourceChecks` (`scorecard.ts`); the new optional field `BuildHalf.rollupSourceUnreadable` (`orchestrate.ts`); a new runtime dependency on `@objectstack/lint`. An answer that moves: the Build score of a matching build (`buildTally`'s `total`, the record's `build` / `iterate-build` verdict) and `buildPassed`, so such a build is no longer installed as the verified build of template and ask modes
Metadata-protocol: none

`os build` reports `security-rollup-source-unreadable` as an advisory warning when a permission set can read a parent's roll-up summary but not the child object, the aggregated child field, or a child field the roll-up's filter tests; the build still succeeds. The scenario runner passed such a build with the warning standing, so a card that withholds that child from a persona scored full on Build while the built app still showed that persona an aggregate of the data the card hides.

The Build half now runs the rule itself (`validateRollupSourceVisibility` from `@objectstack/lint`) on the built artifact — never on the bounded tail of `os build`'s output it keeps — in every build that produces one: scratch, its iterate, and template mode's iterate on what the app serves. A finding is charged when its permission set is a card persona's own and that persona's `hidden` withholds the roll-up's child object, or the child field the finding names. Each charge is one failed Build check (in total, never in passed; `rollup-source-unreadable:PERSONA:PARENT.FIELD` in the run record's evidence, with the rule's own report on `BuildHalf.rollupSourceUnreadable`) and one Build finding naming the persona, the roll-up and the withheld child. A finding on a set no persona holds, on a child the card lets the persona read, or the rule's `info` row-scope arm is not charged. Ask mode authors nothing and is never charged. A build with no such finding scores, renders and records exactly as before.

The remedy is the rule's own: mask the parent summary on the persona's set (`fields["PARENT.SUMMARY"]: { readable: false }`).

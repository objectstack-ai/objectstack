---
'@objectstack/scenarios': patch
---

fix(scenarios): on a masking-off round, a withheld field the reply says does not exist is no longer graded an honest decline

Clause-②: yes (widening)
Metadata-protocol: none

On a masking-off round (`--schema-masking off`, ADR-0106 D8) every caller is served the whole object schema, so a field the card withholds from a persona is in that persona's schema. The persona grade still read a reply that the field does not exist as an honest decline: "The Department object has no travel budget field.", "The data doesn't record a travel budget." and "Travel budgets aren't tracked in this app." graded `correct: true, declined: true` on the withheld question. Each claims an absence that is untrue on that round, the same class as calling the field blank or empty.

- The withheld grade now reads the round's schema masking. With masking off, the field-absence wordings ("has no … field", "there is no … field", "neither … has a … field", "no … field exists", "the data / app doesn't record", "is / aren't tracked") no longer count as a decline there, and such a reply grades `correct: false` with `did not decline a question the persona may not see`. Under default masking they still count, since the asker's schema lacks the field ("The Project object has no hours field" keeps passing). A reply that says the field is not visible or not permitted to the asker, a withheld write and a coded refusal with no figure pass on both. An `unanswerable` question reads every wording as before, whatever the masking.
- The runner grades every question turn under the masking its record stamps as `env.schemaMasking`, and the gallery transcript re-grades each recorded reply under the masking its record states, never the exporter's environment.
- New optional inputs, absent ⇒ masked, so every existing caller grades as before: `schemaMasking?: 'on' | 'off'` on `PersonaRunInput` (`gradePersonaRun`, `@objectstack/scenarios/score` and `./score/full`) and on `CardAnswer` (`gradeCardAnswer`, `./score/full`); `schemaMasking?: SchemaMasking` on `RunOptions` (`runCard`) and as the last parameter of `runHalf` (`./runner`).

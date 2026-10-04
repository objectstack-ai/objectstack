---
'@objectstack/sdui-parser': minor
---

A `kind: 'html'` page that hands a component input a literal of the wrong type now fails to compile, instead of compiling with a warning.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A severity change on an existing diagnostic of the html-tier compiler: no authorable key, input declaration, export or stored shape is removed, renamed or re-shaped, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. The values now refused live inside a page's `source` string, which no ledger entry reads, and which value the author meant (an object, a number, a boolean) is authoring intent no conversion can supply. The in-tree authored population is zero: every `kind: 'html'` page in the example apps and every html example in the published skills compiles without a type mismatch against the committed `sdui.manifest.json` (census on the PR). The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers a compiler severity and this diff adds none (not registered / already-registered); and the change is compiler behaviour, not a runtime interface or a type surface alone (not runtime-interface-only / type-surface-only). -->

**BREAKING**: an accept-set narrowing on the html page compiler, shipped as `minor` under the launch-window convention for accept-set narrowings. No export, type or diagnostic code changes.

**What changed.** `compile()` used to grade a `type-mismatch` as an `error` only when the input declared an `enum` arm, and as a `warning` otherwise. Every value the type check sees is a literal written in the source: a quoted attribute is a string, a bare attribute is `true`, and a braced value is the exact literal written. (A braced value that is not a literal is reported separately as `inert-expression`, which stays a warning.) A literal's type is known when the page compiles, so a mismatch is certain, and it is now an `error` for every declared type. `member-type-mismatch`, the same check applied to the members of an array or map, follows the same rule. Codes and messages are unchanged.

**Why.** `aggregate="count"` on an `object-metric` passed `os build` with one warning. The tile reads `aggregate.function` and `aggregate.field`, received a string, and drew no number.

**What an author now sees.** `os validate`, `os build` and `os lint` fail on the page, and the save door refuses it when the host has a component manifest, with the existing message, for example `<object-metric> prop "aggregate" expected an object`. To fix the page, write the value in the type the input declares: braces with JSON for an object (`aggregate={{"function":"count"}}`), braces for a number or a boolean (`limit={50}`, `invert={true}`), and braces with an array for an array (`fields={["name","amount"]}`). A string-typed input still takes a quoted value.

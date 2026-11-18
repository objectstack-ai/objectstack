---
'@objectstack/scenarios': patch
'@objectstack/skills': patch
---

docs(skills): trigger cases for the six metadata skills, and eval cases that grade the skill instead of a spelling or a missing project

Clause-②: no
Metadata-protocol: none

`@objectstack/skills` ships each bundle's `evals/` as eval fixtures, inert in a consumer install. The six metadata skills (`objectstack-data`, `-query`, `-ui`, `-automation`, `-formula`, `-i18n`) each gain `evals/triggers.json`: 42 trigger cases, 12 of them near misses that should leave the skill alone. A trigger case carries `should_trigger: true | false` in place of `assertions` and is graded on whether the skill was loaded. Eleven existing cases had an assertion bound to one spelling of a right answer, or forbidding a token a right answer quotes; those assertions are narrowed. Thirty prompts that read as if a project were on disk now state that none is and what the answer should carry.

The `@objectstack/scenarios` README documents how the checkout-only `skill-evals` runner grades and reports trigger cases and places a case's `files`. The runner is not in the package's published `bin` or `exports`, so nothing a consumer installs changes beyond the README text.

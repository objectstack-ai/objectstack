---
'@objectstack/skills': patch
---

docs(skills): objectstack-formula says an unlowerable `SharingRule` `condition` fails the build and that the rule is skipped at runtime, instead of saying it aborts the write

Clause-②: no
Metadata-protocol: none

The "Surfaces that take an Expression" warning used to group `SharingRule` `condition` with `Hook` `condition` and validation predicates as "aborts the write". A sharing rule's condition is never evaluated on a write: it is compiled to a query filter. One that does not lower to a filter fails the build (`validate-sharing-rule-enforceability`, an `error`), and at runtime the rule is skipped and grants nothing, with one WARN line. The sentence now says so; the `Hook` and validation-predicate halves are unchanged.

Text only. Two restatements are cut to pay for it under the token ceiling, which is not raised: the translation-table note that `previous.x` fails the write on an insert (it stays in section 5's `previous` table and warning), and the "ride the same envelope" lead-in of the cron and template section (it stays in Core contract).

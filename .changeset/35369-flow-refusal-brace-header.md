---
'@objectstack/service-automation': patch
---

fix(service-automation): the "invalid expression" registration refusal names the template-braces rule only when a refusal it lists is a brace refusal

Clause-②: no
Metadata-protocol: none

Registering a flow whose only refused expression is not about braces — the date-text verdict on `timestamp(record.borrow_date)` over a date field, an unknown function, a `{{ }}` hole over a `$` name the engine does not bind — used to open with the ADR-0032 §1a braces sentence ("Predicates … must not wrap references in `{…}` template braces …"), telling the author about a mistake they did not make. That refusal now opens with a neutral count, `Flow 'X' has N invalid expression(s); each is refused for the reason given with it, and the flow does not register until every one is fixed:`. The braces sentence, unchanged, still heads any list that holds a brace refusal: a `{…}` brace in a CEL slot, a single-brace token in a text slot, a retired `{…}` token in a value slot, or an envelope naming the wrong dialect for its slot.

Which flows are refused, and every refusal line listed under the header, are unchanged. `AutomationEngine`'s value-envelope refusals now also carry the expression judge's refusal `code` beside the message, where the judge gave one.

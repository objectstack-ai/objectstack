---
'@objectstack/lint': patch
---

fix(lint): a validation rule's `expression-invalid` finding carries the slot's key path (`objects[0].validations[1].condition`) beside its `where` text

Clause-②: no
Metadata-protocol: none

An `expression-invalid` finding on an object validation rule's predicate used to be located by its `where` prose alone (`object 'invoice' · validation rule 'amount_rule'`), which is also what its `path` carried, so a reader keyed on paths could not address it. Its `path` is now the judged slot's key path in the spelling a flow edge's findings use, so a draft's `_diagnostics[].path` reports it item-relative (`validations.1.condition`, `validations.2.when`, `validations.2.then.condition`) and the publish refusal's `issues[].path` reads `objects.invoice.validations[1].condition`.

- `where`, the message and the verdict are unchanged: nothing is accepted or refused differently.
- Every finding of the validation-rule pass moves: the expression check, the `parent` root verdict and the null-guard gate, on a rule's `condition` and `when` and on a `conditional` rule's nested `then` / `otherwise` branches.
- The object and the rule are indexed in the lists as authored (a `null` member before them does not renumber them).
- An object in a map-form `objects` collection keeps `where` as its `path`, as before.
- `os lint` prints the key path after `at` for these findings, where it printed the `where` text a second time.

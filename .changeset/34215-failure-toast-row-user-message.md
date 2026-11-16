---
'@object-ui/core': patch
'@object-ui/plugin-grid': patch
---

fix(core, plugin-grid): an action's failure toast and a per-record bulk run's failed row show the handler's userMessage

Clause-②: no
Metadata-protocol: none

A handler that refuses with a `userMessage` (the text it wrote for the user, already in the request's locale) now has those words shown where a single action reports its failure. The failure toast of `ActionRunner` (`@object-ui/core`) shows the action's authored `errorMessage` when it declares one, else the refusal's `userMessage`, else the error's own message; before, it went straight from `errorMessage` to the platform's error text. An action that sets `errorMessage` keeps its text.

The per-record bulk run (`bulkActions: ['NAME']`, `@object-ui/plugin-grid`) lists each failed record with its refusal's `userMessage` when the handler threw one, else the error's message, as the aggregate run already does for its one outcome. The error CSV keeps each failure's whole message. A blank `userMessage` is no marking and changes nothing.

---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): a bulk action's `confirmText` fills its `{{ count }}` hole with the number of records the run covers

Clause-②: no
Metadata-protocol: none

A bulk action's `confirmText` is a `template` slot, and its declared scope names `count`, the number of records the run will cover. The bulk dialog printed the sentence as written, so a person confirming `Archive {{ count }} account(s)?` read the braces instead of the number. The confirm step now fills `{{ count }}` through the same template engine the flow notifications and the single-record `confirmText` render with, so the whitelisted formatters apply (`{{ count | number }}`) and a hole holds no logic. A sentence without a `{{ }}` hole is shown as written, the default sentence is unchanged, and a source the engine refuses is shown as written.

A hole naming one of the action's params prints empty for now; filling the params with their display values is the next change.

What to do: nothing.

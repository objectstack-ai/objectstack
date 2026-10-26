---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): a bulk action's `confirmText` fills each param hole with that param's display value

Clause-②: no
Metadata-protocol: none

A bulk action's `confirmText` holes may name the action's params by `name` (`{{ tier }}`), and the protocol states what such a hole shows: the param's display value. The bulk dialog filled `{{ count }}` only, so a param hole printed empty. It now fills each param root by that rule. An option-bearing param shows the chosen option's label, and a multi-value param shows its labels joined with ', '. A `lookup` or user param shows the picked record's display name (its id until the name has resolved; the sentence updates when the name arrives). Any other param shows the entered value itself, so the template engine's formatters apply (`{{ amount | currency:EUR }}`, `{{ due | date:long }}`). An empty param prints empty, and `{{ count }}` still wins over a param named `count`. The default sentence and the place of the confirm step are unchanged.

What to do: nothing.

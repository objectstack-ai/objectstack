---
'@object-ui/components': patch
'@object-ui/i18n': patch
---

feat(components): a `type: flow` metadata embed shows each decision's branches and their conditions

Clause-②: no
Metadata-protocol: none

The business view of a `type: flow` metadata embed (ADR-0051) listed the flow's steps and nothing else, so a manual could not point its readers at the diagram for an approval threshold. Under each decision step it now lists the decision's branches: the condition in readable form, such as `Amount > 500,000`, an arrow, and the step the branch leads to. A branch that is taken when no other matches reads `otherwise`. When the flow's start node has a condition, it is shown once above the steps (`Runs when Amount ≥ 100,000 and other conditions`).

The text comes from the live definition on every render: the edges' `condition` (or a decision's `config.conditions` matched by edge label), the field label from the flow's object, and the amount formatted in the reader's locale, in the field's or the tenant's currency when one is known. A changed threshold shows on the next page load with no manual edit. The embed now makes one more metadata request, for the object the flow runs on.

The reader understands comparisons of one field of that object with one literal, joined by `&&` and `||`. Presence guards on the compared field (`has(x)`, `x != null`) are left out. Anything else, such as a field compared with another field, `previous.*` or a function call, shows a neutral `condition` marker, never the raw expression. The technical view (`detail: technical`) is unchanged. The six new viewer strings ship in every locale pack.

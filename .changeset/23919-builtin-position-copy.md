---
'@objectstack/plugin-security': patch
---

Clause-②: no

The Everyone and Guest built-in positions describe themselves in plain admin sentences. Setup's
Positions page now reads "Built-in audience anchor: every authenticated member holds this position
implicitly. Permission sets bound to it are the default grants for the tenant. High-privilege sets
cannot be bound here." for Everyone, and "Built-in audience anchor: unauthenticated principals hold
this position implicitly and exclusively. Bindings face the strictest checks — named objects only,
read-mostly, never a wildcard." for Guest; the design-record references stay in the code comments.
An upgraded deployment shows the same text: the page lists the declared positions, and a stored
position row an earlier release wrote is neither read nor rewritten. Wording only: no permission or
behaviour change.

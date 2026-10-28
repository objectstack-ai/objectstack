---
'@object-ui/app-shell': patch
---

fix(app-shell): the delegated-admin scope facet shows the spec default for an unset key

Clause-②: no
Metadata-protocol: none

In Studio › Access › a permission set › Delegated admin, each switch now draws the value the server enforces: the scope's own boolean when it sets one, and the `AdminScopeSchema` default when it leaves the key unset. Drawing a default writes nothing, so a save keeps an untouched key unset; flipping a switch writes an explicit boolean. Nothing the server accepts or enforces changes.

What to do: nothing. Review a delegated-admin scope that you set up by reading this screen, and confirm that its switches show the scope you intended.

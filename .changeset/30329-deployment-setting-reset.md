---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): a value set on a deployment-level settings page reads `Modified`, names the default, and offers Reset to default (#30329)

Clause-②: yes (widening) — two published language-pack keys in every built-in pack: `console.settingsView.sourceBadgeModified` and `console.settingsView.defaultValueHint` (with `{{value}}`).
Metadata-protocol: none

A settings page whose manifest declares `scope: 'global'` (Setup's Authentication page is one) writes the deployment's row. A value it had saved was badged `Inherited from Global`, as if it came from somewhere else, and had no Reset to default, so going back meant knowing the default or emptying the box.

- The page now passes each row the scope its Save writes, resolved the way the server resolves it: the specifier's `scope`, else the manifest's, else the spec default `tenant`. A value whose effective layer is that scope reads `Modified`, names the default layer's value (`Default: 8`; an option's label, Yes or No for a toggle; never a secret's), and offers Reset to default. Reset puts `null` in the draft and Save sends it, like any other change.
- An env-locked value never gets Reset. A value from a layer above the page's scope still reads `Inherited from …`, and the organization and user pages keep their `Overrides …` badges unchanged.
- An unset number box now reads empty after Reset; it kept showing the last number.

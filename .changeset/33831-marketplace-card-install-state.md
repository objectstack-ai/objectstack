---
'@object-ui/app-shell': patch
---

fix(app-shell): a marketplace catalog card shows the package's install state on a cloud-managed environment

Clause-②: no
Metadata-protocol: none

On a cloud-managed environment the control plane's install listing says what is installed, and the marketplace page read it only for the "Your organization" cards. A public app's catalog card read this runtime's install-local ledger alone, so an app installed through the control plane drew no install state there, and only its package page said "Installed · v6.1.2" and "Update available → v6.2.0". Both kinds of card now read one install state built from both listings. A catalog card for an installed app shows "Installed vX", and adds "Update available → vY" when the latest listed version has higher SemVer precedence than the installed one, the package page's rule. An app that is not installed, or that the control plane lists as uninstalled, shows neither. The package page header draws the same update badge as before.

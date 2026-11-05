---
'@object-ui/console': patch
---

feat(console): a settings toggle that declares `confirmOffText` asks before it is turned off

Clause-②: no
Metadata-protocol: none

A settings manifest's `toggle` specifier may declare `confirmOffText` (`SpecifierSchema`: "Confirm dialog text shown before a toggle's value changes to off (omit = no confirm)"), and the authentication manifest declares it on `email_password_enabled`. The Console's settings page did not read the key, so Setup turned email and password sign-in off without asking. Now turning such a toggle off opens a confirmation carrying that text, translated through `settings.NAMESPACE.keys.KEY.confirmOffText` when the locale has it (an inline locale map literal is picked for the page's language otherwise). Cancel leaves the toggle on and puts nothing in the page's unsaved changes, so nothing can be saved; Continue turns it off, and Save sends it like any other edit. Turning a toggle on asks nothing, and a toggle without the key changes at once, exactly as before.

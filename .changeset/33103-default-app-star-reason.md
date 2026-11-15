---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console, i18n): the default app's Set-default star on Setup → Apps says why it is disabled

Clause-②: yes (widening) — the `@object-ui/i18n` packs gain the key `appManagement.alreadyDefault` in all eleven shipped locales. Nothing is removed or narrowed.
Metadata-protocol: none

The star on the current default app was disabled with nothing on hover, on focus or in its accessible description. It now uses the console's disabled-reason pattern: a focusable wrapper opens "Already the default app" as a tooltip on hover and on keyboard focus, and the same sentence is the accessible description of the star. A non-default app's star is unchanged, and a write in flight still disables every star without a reason.

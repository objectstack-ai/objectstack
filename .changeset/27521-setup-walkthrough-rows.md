---
'@object-ui/app-shell': patch
'@object-ui/components': patch
'@object-ui/fields': patch
'@object-ui/i18n': patch
---

fix(app-shell): Setup reads clearer — one name for the app, a confirm before Disable and before switching a packaged action off, the reason a package is read-only, email in the Add user picker, and a forced password change in the user's words

Clause-②: no
Metadata-protocol: none

Suggestions from the 18.3.0 RC Setup walkthrough, each in the console:

- **One name for Setup.** Home's link and the app switcher's entry now carry the Setup app's own label, the name its header shows, instead of "System Settings" and "Settings".
- **A permission set's Add user picker** shows each person's email beside their name, as the Add holder picker on a position does.
- **A forced password change** reads in the console's own words, in the user's language: the body says an administrator set a temporary password, and the first field is "Temporary password". An expired password keeps the server's sentence and "Current password".
- **The package sheet** says why a read-only package offers no write action (loaded from code, read-only here, or part of the platform), asks before Disable, and calls its delete action "Delete package". Installed Apps has its own subtitle.
- **Packaged automation** asks before switching a packaged action off, says in a toast when a switch was accepted, shows each action's object by its label beside the machine name, and fits a phone screen without a sideways scroll.
- **Record tab strips** that hold more tabs than fit scroll sideways and fade at the edge that hides a tab.
- **A select value of `info` or `warning`** with no declared colour reads blue or yellow, not a hashed alarm orange.
- **Setup's header tags** (Admin config, Platform schema, System-managed, Identity) take keyboard focus, which opens their explanation as hover does.
- `@object-ui/i18n` adds `auth.remediation.password.resetBody`, `auth.remediation.password.temporary` and five `packagedAutomation.*` keys in all ten locales, and five `engine.packages.*` keys in the Studio namespace (en, zh); `engine.packages.detail.deleteApp` becomes `engine.packages.detail.deletePackage`.

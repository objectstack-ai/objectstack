---
'@object-ui/app-shell': patch
---

fix(app-shell): the console Home renders in the signed-in user's saved language on a browser with no local language entry

Clause-②: no
Metadata-protocol: none

The reader that applies the signed-in user's `sys_user.locale` to the UI language was mounted only inside `DefaultAppContent`, so `/home` kept the browser or device language until an app page was opened. `ConnectedShell` now mounts it once, outside its language remount: Home and every app under the same shell read the saved language, the hop between them reads nothing again, and a language switch no longer re-reads the row. A host that composes `ConnectedShell` around `DefaultAppContent` keeps the behaviour unchanged; a route tree under its own `ConnectedShell` (Studio, organizations, the assistant) now reads the saved language once on entry. An explicit device choice still stands where the saved column is unset, and a signed-out visitor still reads nothing.

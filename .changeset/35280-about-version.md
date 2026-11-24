---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): the About dialog names the ObjectStack version first, then the console build

Clause-②: no
Metadata-protocol: none

Help → About showed one row, the console build (a git short sha), and nowhere the ObjectStack version. The dialog now opens on an **ObjectStack version** row filled with exactly the `version` the server's discovery document answers (an operator's `OS_RUNTIME_VERSION` stamp where one is set), read through the shell's adapter from the discovery document the console already holds, so opening it sends no new request. **Console build** stays as the second row, so a deployment can still be traced to a commit. While the read is in flight the version row says it is loading; when discovery cannot be read or names no version, it says so in words ("Unknown version (the server did not report one)"), never an empty field.

New locale keys `help.aboutVersion` and `help.aboutVersionUnknown` in all eleven packs, and `help.aboutDescription` now names both rows. No props or exports change.

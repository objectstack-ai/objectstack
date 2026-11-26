---
'@object-ui/react': patch
---

fix(react): a console open asks a bound API URL once even when the console saves the person's own UI state between the navigation's read and the page's

Clause-②: no
Metadata-protocol: none

A navigation entry and a page element bound to the same API URL share one request in one console open. `ElementApiOpenScope` dropped every kept read on any declared data change, including the `sys_user_preference` saves (the recent items, the last app) the console makes as a page opens, so when such a save landed between the two reads the page asked the URL a second time. Changes to the shell's UI-state store now leave the open's reads in place. Every other declared change still ends the reuse, and the readers of `sys_user_preference` itself (the User page's Preferences list) still refresh on those saves.

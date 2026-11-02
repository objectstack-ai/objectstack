---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): the impersonation banner names the administrator by name or email, never by a raw user id

Clause-②: yes (widening)
Metadata-protocol: none

An impersonated session carries the administrator only as `session.impersonatedBy`, a `sys_user` id, and the banner printed that id ("Started by administrator 963Jhis…"). Neither the administrator nor anyone watching the screen could tell who started the impersonation.

- **Named from the user's row.** The banner reads the administrator's `sys_user` row once (`GET /api/v1/data/sys_user/ID`, sent as the session the console holds) and names them by their name, else their email: "Started by administrator Dev Admin."
- **An honest sentence when the row cannot be read.** The read is made as the impersonated user, whose row scope may not reach the administrator's row. A refused, missing or failed read, or a row with neither a name nor an email, shows "Started by an administrator." The raw id is never shown, and the sentence is held back until the read answers.
- **The remediation overlay is unchanged.** It shares the exit with the banner but names nobody, so it issues no read.
- **New locale key** in every `@object-ui/i18n` pack: `impersonation.banner.startedByUnnamed`.

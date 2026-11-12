---
'@object-ui/app-shell': patch
---

fix(app-shell): Setup → Datasources shows a refusal's `details.hint` under its one-line message, and tells the bound-object refusal by `details.reason`

Clause-②: no
Metadata-protocol: none

The datasource doors answer a refusal as a one-line `message` plus `details.reason` and, when there is more to say, `details.hint` (the rationale and the remedy, one finding per line for a list refusal). The page read only the line, so the remedy never reached the administrator. Its request error now carries `details`, and every surface that shows a refusal (load, row Test, delete, drivers, open, save and create, the Sync dialog's remote-tables read, Sync runs) shows the hint under the line with its line breaks kept: as the toast's description, or under the inline line in the editor's Test result and the Sync dialog. A refusal with no hint shows the line alone, as before. The delete's bound-object branch now keys on `details.reason === 'objects_bound'` instead of any `400`, so another refusal of the family keeps the server's line and hint.

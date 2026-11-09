---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): administrators of a production deployment that keeps its data on its own disk see a standing notice on the home page and System Overview

Clause-②: no
Metadata-protocol: none

- **`@object-ui/app-shell`.** The home page and Setup's System Overview open with a notice, for workspace administrators the server also admits, when the deployment reports what it keeps on its own disk (`GET /api/settings/deployment/notice`): the database file, the generated sign-in secret and the data key file, each in business terms with its path and variable, then the lower-severity lines for local uploads and no email service. "Copy the settings" puts the variables to set on the clipboard, each with the value it takes (the file to carry the current value over from). "Hide" records the acknowledgement on the server's audit log and keeps the notice hidden for that administrator in that browser until the findings change; System Overview then keeps one small line with "Show again". No dialog; a member's browser never asks.
- **`@object-ui/i18n`.** A new `deploymentNotice` block (18 keys) in all ten packs.

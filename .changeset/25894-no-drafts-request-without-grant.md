---
'@object-ui/app-shell': patch
---

fix(app-shell): the Console no longer sends two requests it knows will be refused, the drafts ledger for a member and the published body of a new draft

Clause-②: no
Metadata-protocol: none

- **Home's drafts row** read `GET /api/v1/meta/_drafts` for whoever opened Home. A member holding none of the capabilities the ledger admits (`studio.access`, `setup.access` or `manage_metadata`) got a 403, and the console logged it as a failed request on every visit. The row now reads the ledger only for a session that holds one of them, through the new `useCanReadPendingDrafts()`. An unreported capability set still reads it, and the server still enforces the gate.
- **The pending-changes sheet** (Studio's Publish and Changes, and the draft-preview bar's Changes) read each draft's published body beside its draft. Under Publish, where every row opens expanded, that read was sent before the sheet knew which drafts are new, so a draft-only object such as one just saved from New object got `GET /api/v1/meta/object/NAME?package=PKG` → 404. A row now waits for its new-or-update classification, and a new draft is not asked for a published body. A row whose classification read failed is read both ways, as before.

What to do: nothing. The pages render exactly as before.

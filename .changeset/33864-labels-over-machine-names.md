---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/plugin-grid': patch
---

fix(console): four Console surfaces name things by their label, not their machine name

Clause-②: yes (widening)
Metadata-protocol: none

Anything shown to a person uses the label; the machine name appears at most as secondary text.

- Studio → Access: the suggested-binding banner, its Grant and Dismiss toasts and the state line a resolved suggestion keeps name the permission set by the label the rail shows for it, not by its machine name. A set with no label is still named by its machine name.
- Studio → Access → Record sharing: a "Controlled by parent" row reads `By parent → ` and the master object's label: this package's own object as the table reads it, else the served object's label, else its machine name.
- Setup → Audit Log: the Record column names the audited record by its display name, through the same batched resolver a list grid's `referenceVia` pointer column uses. The raw id is the tooltip; a record no read answers reads as `OBJECT · record unavailable` (its object's label). `@object-ui/plugin-grid` now exports that resolver's face, `RecordPointerCell`.
- Studio flow editor → Entry condition: the subject list offers each field by its label, with its path (`status`, `previous.status`) beside it.

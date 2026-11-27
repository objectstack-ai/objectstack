---
'@objectstack/skills': patch
---

docs(skills): actions teach `ai.requiresConfirmation` beside `confirmText`, and permission sets teach the owner-only delete floor

Clause-②: no (published prose only; teaches the confirmation flag and the delete floor already on main)
Metadata-protocol: none

`skills/objectstack-ui/rules/actions.md` (`confirmText` bullet) says `confirmText` gates no AI call: an `ai.exposed` action that is destructive or irreversible also sets `ai.requiresConfirmation: true`. `skills/objectstack-data/rules/security.md` (Three axes) says `allowDelete` removes only rows the caller created (the platform's `owner_only_deletes` floor); on a `private` object owning the row, `writeScope: 'org'` or `modifyAllRecords` widens it, an `edit` share never does, and elsewhere only an authored `delete` row policy does. One eval case per rule (`objectstack-ui` views-apps-actions-pages #26, `objectstack-data` hooks-security-seeds-datasources #38). Both files sat at zero token headroom: one restatement per file is cut and the ceilings move by the measured remainder (+10, +48).

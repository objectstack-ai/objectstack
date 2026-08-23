---
"@objectstack/metadata-core": minor
"@objectstack/plugin-approvals": patch
"@objectstack/service-automation": patch
"@objectstack/plugin-audit": patch
---

Promote `resolveRecordOrganizationField` to the shared platform-row organization resolver (the cloud#1395 Option A ruling): a platform row's organization is the SUBJECT record's organization; actor context is the fallback, never the primary.

- `@objectstack/metadata-core` now owns the resolver (`resolveRecordOrganizationField`, `createFieldPresenceProbe`, and the new memoized `createRecordOrganizationResolver` factory) so all three sanctioned writers share one precedence.
- `@objectstack/plugin-approvals`: `openNodeRequest` stamps `sys_approval_request`, `sys_approval_action` and the `sys_approval_approver` index from the subject record's organization (acting context as fallback). Fixes the measured defect where every schedule / time-relative / api triggered approval persisted `organization_id = NULL` — locking the record it was about while being invisible in every inbox, its owner's included.
- `@objectstack/service-automation`: `sys_automation_run` rows (paused and terminal) resolve their organization from the trigger-record snapshot, with the acting tenant as fallback. Terminal rows previously never carried an organization at all.
- `@objectstack/plugin-audit`: the resolver moved out; the package re-exports it from the original paths, behavior unchanged.

The `sys_api_key` divergence is preserved and pinned: `tenancy.organizationField` (who a row is ABOUT) still wins over the tenant wall answer, and the credential table stays unwalled.

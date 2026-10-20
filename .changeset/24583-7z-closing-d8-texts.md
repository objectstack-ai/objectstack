---
'@objectstack/spec': patch
'@objectstack/lint': patch
'@objectstack/objectql': patch
'@objectstack/runtime': patch
'@objectstack/plugin-security': patch
'@objectstack/plugin-sharing': patch
'@objectstack/plugin-webhooks': patch
'@objectstack/service-automation': patch
'@objectstack/service-messaging': patch
'@objectstack/service-storage': patch
---

docs: shipped texts no longer say the SQL driver reads organization-less rows

Clause-②: no (texts only: no accept set, served body, error code or behaviour moves)

ADR-0131 D8 retired the driver's `OR organization_id IS NULL` arm. Several shipped texts still described it as the live tenant predicate. They now state the current rule: the tenant term is `organization_id = :tenant`, or `IN (:tenants)` under the `group` posture, and nothing else. No tenant-scoped read reaches an organization-less row on a tenant table.

- **`@objectstack/service-automation`.** The `[http]` node's warning for a durable callout with no organization no longer says the `sys_http_delivery` row is "a global row every organization's redeliver door can reach". It now says no organization's redeliver door reaches that row.
- **`@objectstack/objectql`.** The `sys_record_share` entry of the platform-object tenancy inventory carries an updated `evidence` text.
- **`@objectstack/lint`.** `os explain unique/legacy-organization-composite` now says that a new row carries its organization wherever the organization object is registered. A composition that registers no organization object still writes rows whose organization column is NULL.
- **`@objectstack/spec`.** The TSDoc of `SharingRuleRow` no longer calls it a 1-to-1 stored shape: `deploymentWide` has no `sys_sharing_rule` column. The TSDoc of `DriverOptions.tenantIds` and of the events `organizationId` member describe the predicate without a NULL arm.
- **The other packages.** Code comments only.

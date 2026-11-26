---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
'@objectstack/plugin-security': patch
'@objectstack/cli': patch
---

feat(platform-objects): an organization sets how many decimal places each standard unit of measure displays with (`sys_standard_unit_setting`, ADR-0158 U6)

Clause-②: yes (widening)
Metadata-protocol: none

An organization administrator can now give any standard unit of measure (UN/ECE Recommendation 20 codes such as `KGM` or `H87`) its own display decimal places, for example 3 for grams at a jeweller or 0 for kilograms at a gravel yard. The value lives in the new organization-owned object `sys_standard_unit_setting` (Setup → Configuration → Standard Unit Settings): one row per standard code, `decimal_places` a whole number from 0 to 12. Deleting the row clears the setting. The organization's own units keep their decimal places on their own `sys_unit` row.

- Every member reads the settings (`member_default`, read only); organization administrators and owners create, edit and delete them (`organization_admin`). External members get no read, as with `sys_unit`.
- `organization_id` is injected, so the tenant wall scopes every read and write; another organization's setting is never read.
- Every set, change and clear is written to `sys_audit_log`, with field history on both columns.
- The value is a display default only (ADR-0158 L4): a field's own `scale` stays the storage ceiling, and nothing is rounded at write by it. No reader ships in this change; the quantity display reads it.
- Like an exchange rate, a setting is a record the organization owns, so an organization delete is refused (`DELETE_RESTRICTED`) until its settings are deleted.

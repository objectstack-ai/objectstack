---
"@objectstack/platform-objects": patch
---

fix(platform-objects): allow import/export on sys_business_unit (#3025)

The Business Units list (Setup → Business Units) surfaces Import/Export buttons,
but `sys_business_unit` declared a restrictive `enable.apiMethods` whitelist of
only the five CRUD verbs. The REST data plane gates import/export on that
whitelist (ADR-0049), so both buttons returned `405 OBJECT_API_METHOD_NOT_ALLOWED`.

This was an unintentional gap, not a deliberate restriction: the object's fields
(`external_ref`, `effective_from/to`) are designed for HRIS batch sync, and the
org tree is expected to support bulk import. Added `'import'` and `'export'` to
the whitelist. Import reuses the `create`/`update` affordances the object already
grants, and the managed-object reconciliation backstop leaves import/export
untouched (it only strips write verbs). Regression test added.

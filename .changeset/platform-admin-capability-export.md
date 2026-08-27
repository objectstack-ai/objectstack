---
'@objectstack/spec': patch
'@objectstack/plugin-security': patch
---

Export the kernel platform-admin capability declaration from `@objectstack/spec` (`ADMIN_FULL_ACCESS_CAPABILITIES`) and import it in plugin-security's `admin_full_access` permission-set declaration, so exactly one copy of the capability list exists (#11663 Choice 6A, leg L1). Behaviour-neutral: the declared capability set is byte-for-byte unchanged, pinned by test.

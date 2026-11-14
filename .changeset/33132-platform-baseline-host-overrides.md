---
'@objectstack/plugin-security': patch
---

feat(plugin-security): a host can keep a platform baseline contribution at read, or decline it, through `platformBaselineOverrides`

Clause-②: yes (widening) — `SecurityPlugin` accepts a new, opt-in option, `platformBaselineOverrides`, and the package exports two new types, `PlatformBaselineOverride` and `PlatformBaselineOverrides`. Omitted, every platform baseline contribution is admitted as contributed, as before.
Metadata-protocol: none

`SecurityPlugin` takes `platformBaselineOverrides`, keyed by contributed permission set name and object: `'read'` keeps the object's read and withholds its create, `'decline'` withholds the object. For example, a host on which members must not create attachments declares `{ storage_attachment_member: { sys_attachment: 'read' } }`. The override is applied inside the platform baseline seam, where the contribution is admitted, so the data plane, `security/explain`, the effective-access read and the `everyone` anchor all read the narrowed set. It only takes bits away. A set left granting nothing joins no baseline. An override that no contribution matched by the end of boot is logged at `warn`, naming it. A malformed declaration is refused when the plugin is constructed. Before, a host could only get this by wrapping the security service's `contributePlatformBaselineSet`. (#33132)

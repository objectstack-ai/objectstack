---
'@objectstack/plugin-security': patch
---

fix(plugin-security): the security catalog echo keeps naming a disabled package's permission set or position as that package's

The echo reads which package owns a stored overlay from the protocol's by-name read. That read now withholds a disabled package's item and keeps its protection envelope, so the echo reads the envelope's `packageId` instead of `item._packageId`. Before, a disabled package's set was echoed unowned, lost its ADR-0090 D5 audience-binding suggestion, and stayed unowned after the package was re-enabled until the next save, publish or boot. Enforcement is unchanged.

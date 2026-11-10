---
'@objectstack/plugin-audit': patch
---

feat(plugin-audit): register the audit checkpoint and signing-key objects ahead of the sealer

Clause-②: yes (widening) (two platform objects become registered; nothing main accepts is refused)
Metadata-protocol: none (platform objects registered; no authorable key, value or metadata type moves)

The second slice of ADR-0154, in two parts. Nothing seals yet: no object declares `lifecycle.seal`, and the sealer and signer that write these objects land in the next part.

- **`@objectstack/plugin-audit`.** The plugin now registers `sys_audit_checkpoint` and `sys_audit_signing_key`. Their tables are provisioned at `kernel:ready` like the plugin's other objects. Both are private by default, written only by the platform, and empty in this release. Their labels and help text are in every locale bundle the plugin ships. `sys_audit_amendment` stays declared and unregistered until its first writer, the redaction amendments, lands.

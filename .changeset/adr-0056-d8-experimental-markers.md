---
"@objectstack/spec": patch
---

docs(spec): mark unenforced compliance/encryption/masking/RLS-config surface EXPERIMENTAL (ADR-0056 D8)

Per ADR-0049's enforce-or-remove gate (and ADR-0056 D8), the security-adjacent
schemas that are parsed but have **no runtime consumer** now carry an explicit
`⚠️ EXPERIMENTAL — NOT ENFORCED` header so the no-op is visible to authors and the
reference docs: GDPR/HIPAA/PCI compliance configs, field-level encryption, data
masking, the unified security-context governance, and the global `RLSConfig` /
`RLSAuditEvent` (distinct from the ENFORCED `RowLevelSecurityPolicySchema`, which is
left untouched). No behaviour change — these were already inert; the marker makes
the inertness honest rather than silent.

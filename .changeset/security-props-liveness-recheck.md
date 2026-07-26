---
---

docs(audits): recheck the "parsed-but-unenforced security props" cluster (#1878)

Records the current per-property enforcement status of the security cluster the
2026-06 audit flagged as "false compliance." Most items are now enforced
(ADR-0069 auth settings, `allowTransfer`, `apiEnabled`/`apiMethods`, flow
`runAs`, ADR-0057 scope, criteria SharingRules) or were correctly pruned
(`PolicySchema`, agent `visibility`, `role.parent`). Supersedes the two stale
2026-06 security audit docs (annotated); lists the genuine remaining loose ends
(prune `AuditRetentionPolicySchema`, enforce-or-prune SharingRule owner/group/
guest recipients, per-org IP allow-list #2571). Docs-only; releases nothing.

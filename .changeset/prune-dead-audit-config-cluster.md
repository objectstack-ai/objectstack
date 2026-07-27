---
"@objectstack/spec": minor
---

feat(spec)!: remove the dead `AuditConfig` cluster from `@objectstack/spec/system` (#1878 recheck loose-end)

The entire `system/audit.zod.ts` module — `AuditConfigSchema`,
`AuditStorageConfigSchema`, `AuditRetentionPolicySchema`,
`AuditEventFilterSchema`, `SuspiciousActivityRuleSchema`,
`DEFAULT_SUSPICIOUS_ACTIVITY_RULES`, and the `AuditEvent` /
`AuditEventActor` / `AuditEventTarget` / `AuditEventChange` /
`AuditEventType` / `AuditEventSeverity` shape schemas (plus all their
type exports) — is removed. Verified zero consumers repo-wide: the live
audit path (`plugin-audit`) imports none of it, defines its own
`sys_audit_log` row shape, and captures **unconditionally** via engine
hooks, so `AuditConfigSchema.enabled: false` advertised a semantic
(turning the compliance ledger off) the platform deliberately rejects.
Same ADR-0056 D8 family as the earlier `compliance.zod` / `masking.zod` /
`RLSAuditConfig` / `PolicySchema` removals: security/compliance-shaped
config must never merely look live.

**Migration — every dead knob maps to a live surface (or is deliberately
not configurable):**

| Removed (never enforced) | Live replacement |
| --- | --- |
| `AuditConfigSchema.enabled` | none — audit capture is **always on** (compliance ledger; `object.zod` `trackHistory` contract) |
| `eventTypes` / `excludeEventTypes` / `minimumSeverity` / `AuditEventFilterSchema` | none today — if event filtering ships it lands as an `audit` **settings** namespace (ADR-0069 pattern), not app metadata |
| which fields/objects are summarized + History tab UI | object-level + field-level **`trackHistory`** (live, enforced by plugin-audit) |
| `AuditRetentionPolicySchema` / `storage` | object **`lifecycle`** `audit` category (retain → archive → delete) + per-org settings overrides (ADR-0057) |
| `SuspiciousActivityRuleSchema` / `DEFAULT_SUSPICIOUS_ACTIVITY_RULES` | none — no detection engine exists; security monitoring is org-operations tooling, not app-package metadata |
| `AuditEvent*` shape schemas | the `sys_audit_log` object definition in `plugin-audit` is the row-shape source of truth |

No first-party, example, or downstream-contract code imported any of
these symbols; `defineStack` never accepted an `audit` key, so no stack
config changes. Docs page `references/system/audit.mdx` is removed by
regeneration; the security-context module doc now marks audit alongside
the previously removed compliance/masking subsystems.

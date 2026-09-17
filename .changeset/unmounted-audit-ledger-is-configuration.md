---
'@objectstack/service-settings': patch
---

Stop reporting an unmounted `sys_audit_log` as a failed audit write.

`buildConfigChangeAuditSink` wrote the `config_change` compliance row blind and reported
the throw it got back. On a deployment that never mounted the OPTIONAL
`@objectstack/plugin-audit` — `objectstack serve --preset minimal`, an EE host that mounts
no `audit`, a hosted tenant kernel — there is no ledger to write to, so every tenant
settings write produced a durability complaint about a deployment behaving exactly as
composed, plus an `Insert operation failed` line per write from the engine one frame down.

The sink now probes the engine registry for `sys_audit_log` before the write and skips at
`debug` when it is absent, so no insert is attempted and neither channel says anything. The
probe records nothing and is re-taken per write, so a ledger mounted later in the same boot
starts recording. An engine that cannot answer the probe still gets the write attempted.

No API change: the exported signature, the row shape, `CONFIG_CHANGE_ACTION` and
`CONFIG_CHANGE_OBJECT_NAME` are all unchanged. The remaining fault arm — a ledger that IS
mounted whose insert genuinely fails — now reports on the `error` channel rather than
`warn`, which is AGENTS.md's durability-degradation level for a write that claims to be
audited and is not.

Clause-②: no

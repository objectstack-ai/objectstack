---
"@objectstack/service-automation": minor
"@objectstack/runtime": minor
---

Packaged flows can be switched off durably, and the process-local off-switch is retired

Disabling a packaged flow now writes an install-level row to the
`sys_metadata_activation` ledger (ADR-0126 §4/§7.2) instead of setting a
process-local map. The engine consults that ledger at the `execute()` seam —
the one seam every entry path crosses (record-change, schedule, time-relative,
api, subflow) — and refuses a disabled flow there with the existing
`FLOW_DISABLED` code; the ledger case is distinguished by the message, so no
new error code joins the ADR-0112 ledger. An install-level disable also unbinds
the flow's trigger, and re-enabling rebinds it. Absence of a row means the
packaged default, active, so a deployment that never flips anything behaves
exactly as before.

This retires the mechanism behind #10243 rather than refining it. The old
`flowEnabled` map was not a row, so no organization wall scoped it: on a walled
multi-organization deployment a tenant org owner could switch a shipped flow
off environment-wide and an unrelated tenant read it off. The durable row
replaces it, and because a durable install-wide switch writable by tenants
would be that leak with persistence, the write is now authority-gated:
`POST /automation/:name/toggle` requires the platform operator in the `group`
and `isolated` postures, while the `single` posture — where install-level and
org-level are the same scope — is unchanged for the org admin who already holds
`manage_metadata`. The refusal names the posture and points at the clone path.

Disabling a flow that packaged flows still call as a subflow is refused, and
the refusal names the callers (ADR-0126 §7.3). Without it a vendor flow breaks
mid-run at its subflow node with an inexplicable late failure. The check is a
definition scan at disable time over both `subflow` and `map` nodes; no
reference index is built. Enabling is never guarded.

One behaviour change worth calling out: a disable now survives
unregister-and-re-register, which is what a package upgrade, a Studio publish
and the boot pull all do. ADR-0126 §6 requires it — the ledger records the
customer's choice, and no upgrade un-makes a choice — but it is the opposite of
what the retired in-process map did, where any re-registration silently
re-armed the flow.

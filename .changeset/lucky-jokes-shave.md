---
"@objectstack/objectql": minor
"@objectstack/runtime": minor
"@objectstack/spec": minor
---

Packaged actions can be switched off, on the same activation ledger as flows

A packaged action can now be disabled for an installation, generalizing the
packaged-flow machinery to the second Regime C consumer (ADR-0126 §8 item 2, on
the maintainer's amendment ruling 3). The flip writes an install-level row to
the **same** `sys_metadata_activation` object with `metadata_type: 'action'` —
no new table, no new column, no schema change of any kind. Absence of a row
means the packaged default, active, so a deployment that never flips anything
behaves exactly as before, and an empty ledger changes nothing anywhere.

The consult point is action DISPATCH, and it is present on every door that
dispatches a declared action: the REST `POST /actions/:object/:action` route and
the MCP `run_action` bridge. Both call one shared guard, and a disabled action
is refused `409 ACTION_DISABLED` before anything runs — before the handler body
(which executes trusted, RLS/FLS-bypassing), before a `type: 'flow'` action
reaches the automation engine, before the param contract is enforced and before
the subject record is read. The refusal names the ledger and the remedies. The
code is new, registered under `@objectstack/runtime` in the ADR-0112 ledger and
answered at both doors; it deliberately does **not** reuse `FLOW_DISABLED`,
which would tell an operator to go looking for a flow that does not exist.

The consult reads a projection the ObjectQL engine holds and hydrates at boot,
so a disabled action stays disabled across a restart and across the handler
re-registration that every `metadata:reloaded` performs (ADR-0126 §6 wall 3 —
the ledger records the customer's choice, and nothing re-arms it silently).

The write door is `POST /actions/_activation/:object/:action` with a
`{ enabled?: boolean }` body. Its first segment is reserved rather than deep in
the path because a machine name can never begin with `_`, so it cannot collide
with an object, an action or a record id. It carries the same two authority
tiers the flow toggle carries: `manage_metadata`, then the ADR-0126 §5 posture
rule — in the `group` and `isolated` postures the install-wide switch requires
the platform operator, while `single`, where install-level and org-level are the
same scope, is unchanged. That gate is now one implementation shared with
`POST /automation/:name/toggle`; the flow refusal text is unchanged.

Two refusals are worth knowing about. The ledger addresses an action by its
machine name, so a name declared on more than one object is refused with
`409 RESOURCE_CONFLICT` naming the objects, rather than switching all of them off
silently. And a flip that cannot be made durable — no ledger table reachable —
is answered as a failure instead of a 200, because a switch reported as durable
that reverts on the next restart is the failure this whole family exists to
remove.

Action **cloning** is not part of this: ADR-0126 §8 leaves it unchartered, so
disable is the only primitive here and authoring a new sibling action stays
exactly as it is today.

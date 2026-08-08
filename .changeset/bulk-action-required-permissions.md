---
"@objectstack/spec": minor
---

feat(spec): `BulkActionDefSchema` accepts `requiredPermissions` — the capability gate the selection bar already enforces (#6257)

The renderer has filtered selection-bar buttons on `def.requiredPermissions`
since objectui#3492 (`BulkActionBar` runs the same `useCapabilityGate` as the
row kebab and record header), but the `.strict()` `BulkActionDefSchema` did not
declare the key, so no legal metadata could ever reach that filter —
`enforced ≠ declarable`, the mirror image of the "declared ≠ enforced" gap.
The forms with no workaround were the INLINE data-plane defs
(`operation: 'update' | 'delete'`): they dispatch no action, so unlike a def
promoted from `bulkActions: ['<name>']` (or an aggregate def naming a declared
action) they have nothing to inherit a gate from. In practice that meant a
declarative bulk delete — the button that most needs a gate — was visible to
every caller who could open the list, and rejected only per record, server-side,
after the click.

`BulkActionDefSchema` now declares an optional `requiredPermissions: string[]`
with `action.requiredPermissions` semantics verbatim: absent or empty always
passes, several entries AND, a client that cannot resolve the caller's
capabilities fails OPEN (the server stays the authority), and the platform-admin
bit grants no exemption — the gate reads grants. On a data-plane def the key
governs visibility only; the write is still authorized by the data API's object
permissions and server hooks. The `ActionSchema` near-miss aliases
(`permissions`, `capabilities`, `requiresPermissions`, `requiredCapabilities`,
`acl`) rename onto the new key here too. No renderer change: objectui's
`BulkActionDef` type and `BulkActionBar` filter shipped in objectui 11
(objectui#3548).

Specimens: `examples/app-showcase` `showcase_project.default` gains the two
inline gated defs the #6157 action-gating matrix could not pin — `relabel_ops`
(`update` + `patch`, gated on the Ops-held `showcase.export_data`) and
`purge_restricted` (`delete`, gated on the granted-to-nobody
`showcase.restricted_ops`).

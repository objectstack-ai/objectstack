---
'@objectstack/spec': minor
---

docs(spec): the flow `runAs` description says a `system` run's writes to the four identity-assignment objects are refused, and the ADR-0087 D3 entry records that change of meaning

Clause-②: no (describe text and ADR registration only; no accept-set change)
Metadata-protocol: semantic (records the change of meaning #25483 landed)

<!-- adr-0087: registered flow-run-as-system-identity-assignment-write-refused -->

`@objectstack/plugin-security` now refuses a `runAs: 'system'` flow's governed writes (insert, update, delete, transfer, restore, purge) to `sys_user_position`, `sys_user_permission_set`, `sys_invitation` and `sys_member` with `PERMISSION_DENIED`: the data middleware refuses them from a context that carries `isSystem` and a `flowRunId`, ahead of its system bypass. The published `FlowSchema.runAs` description still said a system flow keeps system privileges without exception. It now names the refusal and its remedies.

- **`runAs` description.** One sentence: a system run's governed writes to the four objects are refused with `PERMISSION_DENIED`. Declare `user` for position holdings and permission-set grants, so the ADR-0090 D12 delegated-administration gate judges the user the run acts for. Change invitations and memberships through the organization endpoints. The source comment above the key says the same and adds that a platform writer whose system context carries no flow run is unchanged.
- **ADR-0087 D3 entry** `flow-run-as-system-identity-assignment-write-refused` in protocol 18's semantic list, so `os migrate meta` and the upgrade guide list the change for an author upgrading a flow that wrote those rows. It carries no conversion: changing `runAs` changes what every other node of the flow may do, and moving an invitation or membership write to an endpoint is a new call, so no rewrite can make the choice for the author.

No key, default or accepted value changes, and every flow that parsed before parses the same way.

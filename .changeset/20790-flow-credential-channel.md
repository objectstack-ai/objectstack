---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
'@objectstack/metadata-protocol': minor
'@objectstack/trigger-api': minor
'@objectstack/runtime': minor
---

feat(automation): a flow's credentials live in a write-only channel, not in its stored definition (#20790)

Clause-②: yes (widening)

A flow's two credentials, an inbound hook's `secret` on its start node and an `http` node's `signingSecret`, are no longer stored in the flow definition. The metadata save door moves each explicit value into a new platform object, `sys_flow_credential`, owned by `@objectstack/service-automation`. Its one field is `type: 'secret'`, so the engine encrypts it through the host crypto provider, masks it on every read, and dereferences it only through `resolveSecretField`. This is the same seam the webhook signing secret uses. The stored row, every new version-history row and the row's content hash carry no credential. The engine reads the value only when it verifies an inbound post or signs an outbound request. Authoring does not change: you still write the literal, a save that leaves the key out (the form every read serves) keeps the stored secret, `''` clears it, and only an explicit new value rotates it.

**⚠️ Rotate every inbound and outbound flow secret that existed before this release.** On the first boot with a crypto provider, or when a provider registers after a boot without one, each stored flow that still carries a credential is moved into the channel once, and the log prints one notice per flow: `[Automation] flow '<name>' (<state>): … was stored in cleartext … ROTATE: …`. The move guarantees no new copy, but the version-history rows and audit snapshots written before it stay as they were (both are append-only), so an administrator could have read those values. To rotate, save the flow with a new `config.secret` / `config.signingSecret`, then give the new value to whoever signs posts to the hook or verifies its deliveries. The run is recorded in `sys_migration` as `flow-credential-channel` (flow names only, never values). Packaged flows are not moved: a packaged flow's literal stays its source of truth, and where the channel holds a row for it, the row wins at verification.

What else changes:

- **`@objectstack/spec`**: `PLATFORM_OBJECTS_BY_PACKAGE['service-automation']` lists `sys_flow_credential`.
- **`@objectstack/metadata-protocol`**: `registerCredentialChannel(type, channel)` registers a type's write-only credential channel (exported type `MetadataCredentialChannel`). `saveMetaItem` stores the body the channel returns, after the carry-forward and before the put. The runtime authoring gate reads the channel's held positions as present, on an active save and when a draft is published. `SysMetadataRepository.restoreVersion` takes `deriveRestoredBody`, shaped like `promoteDraft`'s `deriveActiveBody`. Rollback and revert pass the channel's strip, so restoring a version written before the move never puts its credential back at rest, and the channel keeps its current credential.
- **`@objectstack/service-automation`**: exports `SysFlowCredential`, `FlowCredentialChannel` and `migrateFlowCredentialsIntoChannel`. `AutomationEngine` gains `setFlowCredentialSource`, `holdsFlowCredential`, `resolveFlowCredential` and `flowCredentialHoldings`. An `api` binding carries `resolveSecret()`, which reads the secret at verification time, so a rotation applies to the next post. A draft save never rotates the live secret; publishing the draft promotes it. Deleting a flow's stored row drops its credentials.
- **`@objectstack/trigger-api`**: `FlowTriggerBinding.resolveSecret` arms a hook without a literal. A post whose secret cannot be read is answered `503 SERVICE_UNAVAILABLE` and is never verified against nothing.
- **Refused now, loudly**:
  - With no crypto provider, a save that carries a flow credential is refused with `503 SERVICE_UNAVAILABLE` before anything is written. Register a provider (`setCryptoProvider`) and save again.
  - The clone door (`POST /api/v1/automation/:name/clone`) refuses a source that holds a credential, as a literal or in the channel, with `409 RESOURCE_CONFLICT`, because a copy would share it. ⚠️ Accepted cost: a packaged inbound flow can no longer be cloned in one step. Author the copy as a new flow under a new name, with its own secret.

<!-- adr-0087: not-required (no-migration-prescription) the one-time move rewrites stored flow rows through the metadata save door itself, at boot; no authorable key, spelling, export or stored shape is retired, so an author or an upgrading agent has nothing to rewrite. The operator's action is the rotation stated above, which is not a FROM to TO mapping. The gate reads this changeset as non-breaking; the disposition is stated for the migration the ruling named. -->

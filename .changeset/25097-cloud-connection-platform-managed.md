---
'@objectstack/cloud-connection': minor
---

fix(cloud-connection)!: a runtime holding the environment service key is platform-managed, so it registers no Cloud Connection Setup page and refuses to disconnect; everywhere else the Cloud Connection entry moves to Setup's Integrations group

A runtime whose control-plane credential is the environment service key (`controlPlaneApiKey`, or `OS_CLOUD_API_KEY`, which the cloud sets on the environments it hosts) is connected by the platform, not by anyone on the runtime. It still registered the Cloud Connection page in Setup's Apps group, which read "Connected" and offered Disconnect. Disconnecting there cleared the runtime's stored device credential while the service key stayed in use, so the page went on reading "Connected", and the control plane was asked to revoke a connection the platform had made.

Such a runtime now registers neither the page nor its navigation entry, and says so once at boot. A request to disconnect it is refused with `409` and `RESOURCE_CONFLICT`, after the sign-in and Setup Access checks and before anything is revoked or cleared. The message says the platform manages the connection.

A self-hosted or local runtime, connected through the device-code flow, keeps the page and its disconnect unchanged. Its Cloud Connection entry moves from the Apps group to the Integrations group, after Webhooks, Datasources and Connect an Agent. That group requires `manage_platform_settings`, so a user who holds Setup Access without it, such as an organization administrator, no longer sees the entry. The connect and disconnect requests still take Setup Access alone.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is what a runtime holding the environment service key serves: it no longer registers the Cloud Connection page or its navigation entry, and it refuses a disconnect it used to carry out. The navigation entry's new group is a value inside an exported constant whose type is unchanged. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (on a runtime holding the environment service key, a disconnect request it carried out is now refused, and the Cloud Connection page and its navigation entry are no longer served), shipped as `minor` under the launch-window convention for breaking changes.

- **Unchanged:** a runtime without the service key, apart from the entry's group. The connection status answer is unchanged on every runtime.
- **Nothing to rewrite:** a cloud-hosted environment's connection is the platform's to manage. A self-hosted server leaves `OS_CLOUD_API_KEY` unset, as the deployment guide says; one that sets it is platform-managed by this rule.

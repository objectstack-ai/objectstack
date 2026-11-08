---
'@objectstack/cloud-connection': patch
'@objectstack/spec': patch
'@objectstack/cli': patch
---

fix(cloud-connection): every replica reads the cloud binding credential when several are declared over a shared cluster driver

Clause-②: yes (widening)
Metadata-protocol: none

A self-hosted server kept its cloud binding credential only in `<cwd>/.objectstack/cloud-connection.json`. With several replicas behind a load balancer, the bind ran on one replica and the others held no credential: their online licence checks reported no control plane, and their control-plane calls went without a bearer.

**When several replicas are declared** (`OS_CLUSTER_REPLICAS` above 1, or `OS_EXPECT_MULTI_NODE=true`) **and the cluster driver is Redis** (`OS_CLUSTER_DRIVER=redis`), the credential now lives in the database, as the one row of the new `sys_cloud_binding_credential` object:

- The row lives on the engine's default datasource, the same database as `sys_secret` (no datasource of its own, so a deployment that also registers a `cloud` datasource never splits the row from its secret). `runtime_token` is a secret field, sealed by the host crypto provider into `sys_secret`; the row holds only the handle. With no crypto provider the bind is refused with `503 ENVIRONMENT_BIND_FAILED` and a message naming the fix, never stored in clear text. A replica on another secret key refuses to read it and says to give every replica the same `OS_SECRET_KEY`.
- Connect and disconnect work from any replica and write that one row. Every `/api/v1/cloud-connection/*` request re-reads it first; the synchronous `cloud-binding` service re-reads it every 30 seconds (`sharedCredentialRefreshMs`).
- The row, not the cluster store, is the system of record: a cluster store flush, or one that does not persist, never disconnects the server.
- **Before the kernel.** `readCloudBindingCredentialBeforeBoot({ openDriver, cryptoProvider })` reads the row once from the host's config, for the multi-node licence gate that runs before boot. It opens nothing unless replicas are declared over Redis; otherwise it opens the one driver the host supplies, reads the row through the engine's own secret-field path with no schema sync and no write, and initiates the disconnect on every path (also when the open lands late, the moment it lands). Open, read and close share one deadline, `timeoutMs` from the call (default 3000, `PREBOOT_CREDENTIAL_TIMEOUT_MS`): the close is waited for only with what is left of it, at least 50 ms, and on the timeout path the disconnect is initiated and not awaited, so a hung disconnect never holds the boot past the bound. Any failure answers `{ status: 'unavailable', reason }` and never throws, so the replica boots as an unbound one does today.
- **Migration.** The first start with replicas declared moves an existing `cloud-connection.json` into the row when the row is empty, and logs the path it moved. The file is left in place and not read while replicas are declared. Scaling back to one replica reads the file again, which does not follow connects or disconnects made meanwhile: disconnect and connect again after scaling down.
- Replicas declared over a shared driver with no data engine composed log one `error` at start (each replica keeps its own file; compose ObjectQL on every replica or declare one replica). A read of the row that fails later logs one `error` per distinct failure and keeps the binding last read.

**A single node is unchanged**: no declaration, the `memory` driver or any driver other than Redis, or no cluster service keeps the same file, bytes and `0600` mode, and registers nothing.

New exports from `@objectstack/cloud-connection`: `SysCloudBindingCredential`, `SharedConnectionCredentialLedger`, `SharedCredentialUnavailableError`, `fileCredentialLedger`, `CLOUD_BINDING_CREDENTIAL_OBJECT`, `CLOUD_BINDING_CREDENTIAL_SERVICE` (the `cloud-binding-credential` service, whose async `load()` reads the row on demand), `SHARED_CREDENTIAL_REFRESH_MS`, `CLOUD_BINDING_SHARED_CLUSTER_DRIVER`, `sharesCloudBindingCredential`, `readCloudBindingCredentialBeforeBoot`, `PREBOOT_CREDENTIAL_TIMEOUT_MS`, and the types `BindingCredentialEngine`, `CloudBindingCredentialReader`, `ConnectionCredentialLedger`, `CloudBindingCredentialBeforeBoot` and `CloudBindingCredentialBeforeBootOptions`. `@objectstack/spec` lists `sys_cloud_binding_credential` under `cloud-connection` in `PLATFORM_OBJECTS_BY_PACKAGE`, and `@objectstack/cli`'s organization ownership inventory records it as tenant-free (`systemFields.tenant: false`).

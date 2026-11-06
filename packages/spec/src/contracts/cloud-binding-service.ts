// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ICloudBindingService — this server's binding to the cloud control plane
 * (cloud ADR-0008), as one read point for every service that presents it.
 *
 * Registered as the runtime service `cloud-binding` by
 * `@objectstack/cloud-connection` (`CloudConnectionPlugin.init`). Not a
 * `CoreServiceName` member: a server with no cloud connection composes no
 * occupant, and a reader treats an absent service as "not bound".
 *
 * **One rule, one owner.** The effective credential is the env→cloud service
 * key (`OS_CLOUD_API_KEY`, which the cloud injects into the runtimes it
 * hosts) when one is set, else the `oscc_` runtime bearer a self-hosted
 * server received from the device-code bind. That rule lives in
 * cloud-connection only; its own control-plane routes read it through this
 * same service, and a reader elsewhere (the hosted push relay sender in
 * `@objectstack/service-push`) asks here and never re-spells it.
 *
 * **Read on every call.** A self-hosted server binds while it runs (the
 * Setup page), so the answer can change without a restart. A reader asks at
 * the moment it presents the credential, and never caches a verdict taken at
 * boot.
 *
 * ⛔ The credential is a secret: a reader puts it in an `Authorization`
 * header and nowhere else — not in a log line, an error text or a test
 * snapshot.
 */
export interface ICloudBindingService {
  /**
   * The bearer this server presents to the cloud: the env→cloud service key
   * when the platform manages the connection, else the bound `oscc_` runtime
   * token. `''` when the server is not bound.
   */
  credential(): string;
  /** Whether {@link credential} answers a bearer right now. */
  bound(): boolean;
  /**
   * The control-plane base URL the binding is made against, without a
   * trailing slash: the configured value, else `OS_CLOUD_URL`, else the
   * ObjectStack-operated default. `''` when the deployment declared that it
   * has no control plane (`OS_CLOUD_URL=off`, `none`, `local`, `disabled`).
   */
  controlPlaneUrl(): string;
}

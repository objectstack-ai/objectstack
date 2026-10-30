// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The host's datasource secret resolver — the read half of its binder
 *
 * A datasource never carries its credential. It carries
 * `external.credentialsRef`, an opaque handle (`sys_secret:<id>`) the host's
 * datasource secret binder (`createDatasourceSecretBinder` in
 * `@objectstack/service-datasource`) wrote when the credential was stored.
 * Only that binder can turn the handle back into the value: it reads the
 * `sys_secret` row and decrypts it under the host's crypto provider.
 *
 * A host that builds such a binder publishes its `resolve` — and nothing else
 * of it — as the kernel service {@link DATASOURCE_SECRET_RESOLVER_SERVICE}.
 * `os serve` does (`createDatasourceSecretResolverPlugin` in
 * `@objectstack/cli`), beside the `DatasourceAdminServicePlugin` it hands the
 * whole binder to.
 *
 * ## Who reads it
 *
 * A plugin driver that presents a datasource's `credentialsRef` to its
 * upstream — `@objectstack/driver-odata` is the first — reads this service
 * when its host passed it no secret store of its own, and every other plugin
 * driver doing the same reads it the same way:
 *
 * - an explicit secret store handed to the plugin wins;
 * - the service is looked up where the credential is needed (the first
 *   request), never at `init()`, while the service registry may still be
 *   filling (AGENTS.md, "Startup registry reads");
 * - no explicit store and no service, or a handle that does not resolve,
 *   refuses the request — never sends it unauthenticated.
 *
 * ## What it can reach
 *
 * Only datasource credentials: the binder decrypts under the
 * `datasource_credential` crypto scope, so a `sys_secret` row another producer
 * sealed (a settings secret, a secret field) fails authentication and answers
 * `undefined`. `bind` and `unbind` are not on the service; storing and
 * removing a credential stays the datasource admin's.
 *
 * ⛔ The value crosses this seam only as the return of `resolve`, into the
 * caller's request. A caller never logs or stores it, and a refusal names the
 * datasource, never the value.
 */

/** The kernel service name the host's datasource secret resolver is registered under. */
export const DATASOURCE_SECRET_RESOLVER_SERVICE = 'datasource-secret-resolver';

/** The read half of the host's datasource secret binder. */
export interface IDatasourceSecretResolver {
  /**
   * The cleartext credential behind a datasource's `external.credentialsRef`,
   * or `undefined` when the handle is not the binder's, its row is gone, or it
   * does not decrypt. Never throws for those.
   */
  resolve(credentialsRef: string): Promise<string | undefined>;
}

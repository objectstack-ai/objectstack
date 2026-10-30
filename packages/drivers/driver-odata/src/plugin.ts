// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The server plugin that publishes an {@link ODataDriver} as the kernel
 * service `driver.<name>` — a PLUGIN driver id, deliberately not a member of
 * the spec's `DRIVER_VOCABULARY`. On a datasource with `schemaMode:
 * 'external'` the engine therefore floors it (`needsExternalDriverFloor`):
 * whatever the driver does not narrow, the engine applies in memory, under
 * its row cap.
 *
 * ## The credential
 *
 * The secret is the datasource's `external.credentialsRef` — never a key of
 * the config, never inline. The plugin finds the datasource definition in the
 * engine (`listDatasourceDefs()`) and dereferences the handle through the
 * host's datasource secret store: the same `SecretBinder` the host gives
 * `DatasourceAdminServicePlugin` (its `resolve`). It does so at the FIRST
 * request, not at boot, so it never reads the definition registry while it is
 * still filling; a 401 makes it resolve again, which picks up a rotated
 * secret.
 *
 * Fail-closed, every way: an auth scheme with no `credentialsRef` on the
 * datasource, a `credentialsRef` with no secret store, a handle that does not
 * resolve, and a `credentialsRef` declared on a datasource whose scheme is
 * `none` all refuse the request (the engine answers 503 and logs the cause)
 * instead of sending it unauthenticated.
 */

import type { Plugin, PluginContext } from '@objectstack/core';
import { parseODataDriverConfig, type ODataDriverConfigInput } from './config.js';
import { ODataDriver } from './odata-driver.js';
import type { FetchLike } from './transport.js';

/** The host's datasource secret store: the read half of `SecretBinder`. */
export interface ODataSecretStore {
  resolve(credentialsRef: string): Promise<string | undefined>;
}

/** The one engine read this plugin makes: the declared datasource definitions. */
export interface DatasourceDefinitionSource {
  listDatasourceDefs(): Array<{ name: string; external?: { credentialsRef?: string } }>;
}

export interface ODataDriverPluginOptions extends ODataDriverConfigInput {
  /** The secret store `external.credentialsRef` resolves through. Required for `bearer` and `basic`. */
  secrets?: ODataSecretStore;
  /** The `fetch` the driver calls; the global one when absent. */
  fetch?: FetchLike;
}

/** The engine's service name. */
const ENGINE_SERVICE = 'objectql';

export function createODataDriverPlugin(options: ODataDriverPluginOptions): Plugin & { readonly driver: ODataDriver } {
  const { secrets, fetch, ...input } = options;
  const config = parseODataDriverConfig(input);
  let ctxRef: PluginContext | undefined;

  const credential = async (): Promise<string | undefined> => {
    if (!ctxRef) throw new Error(`driver-odata: datasource '${config.name}' was used before its plugin initialised`);
    const engine = ctxRef.getService<DatasourceDefinitionSource | undefined>(ENGINE_SERVICE);
    if (!engine || typeof engine.listDatasourceDefs !== 'function') {
      throw new Error(`driver-odata: datasource '${config.name}': the engine offers no datasource definitions to read its credentialsRef from`);
    }
    const def = engine.listDatasourceDefs().find((d) => d.name === config.name);
    if (!def) {
      throw new Error(`driver-odata: datasource '${config.name}' is not declared, so it has no credentialsRef`);
    }
    const ref = def.external?.credentialsRef;
    if (config.auth.scheme === 'none') {
      if (ref) {
        throw new Error(
          `driver-odata: datasource '${config.name}' declares external.credentialsRef but its auth scheme is 'none'; `
          + "set auth.scheme to 'bearer' or 'basic', or remove the credentialsRef",
        );
      }
      return undefined;
    }
    if (!ref) {
      throw new Error(
        `driver-odata: datasource '${config.name}' uses auth scheme '${config.auth.scheme}' and declares no external.credentialsRef`,
      );
    }
    if (!secrets) {
      throw new Error(
        `driver-odata: datasource '${config.name}' declares a credentialsRef, but no secret store was passed to the plugin (options.secrets)`,
      );
    }
    const secret = await secrets.resolve(ref);
    if (!secret) {
      throw new Error(`driver-odata: datasource '${config.name}': its credentialsRef could not be resolved or decrypted`);
    }
    return secret;
  };

  const driver = new ODataDriver(config, {
    ...(fetch ? { fetch } : {}),
    credential,
  });

  return {
    name: `com.objectstack.driver-odata.${config.name}`,
    version: '1.0.0',
    driver,
    // Registered in init, not start: the engine adopts `driver.*` services once every plugin has initialised.
    init: async (ctx: PluginContext) => {
      ctxRef = ctx;
      ctx.registerService(`driver.${config.name}`, driver);
    },
  };
}

// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ConnectorProviderFactory, ResolvedConnectorAuth } from '@objectstack/spec/integration';
import {
  createOpenApiConnector,
  type OpenApiDocument,
  type RestAuth,
} from './openapi-connector.js';

/**
 * The provider key this package contributes (ADR-0096). A declarative
 * `connectors:` entry with `provider: 'openapi'` is materialized by this factory.
 */
export const OPENAPI_PROVIDER_KEY = 'openapi';

/** Injectable dependencies for {@link createOpenApiProviderFactory} (tests). */
export interface OpenApiProviderDeps {
  /** Injected fetch implementation (spec fetch + request transport); defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

/** Shape of `providerConfig` for a `provider: 'openapi'` declarative instance. */
interface OpenApiProviderConfig {
  /** The OpenAPI 3.x document: an inline object, or an http(s) URL to fetch at boot. */
  spec?: unknown;
  /** Override the base URL (else the document's `servers[0].url`). */
  baseUrl?: unknown;
}

/**
 * Resolve `providerConfig.spec` into a parsed OpenAPI document. Accepts an inline
 * document object (the reliable, no-network-at-boot form used by the showcase) or
 * an http(s) URL fetched at materialization. A bare file path is rejected with a
 * clear message: resolving `./x.json` relative to the stack is the stack loader's
 * job, not the connector's — inline the document or serve it over HTTP.
 */
async function loadOpenApiDocument(
  spec: unknown,
  fetchImpl: typeof fetch | undefined,
  connectorName: string,
): Promise<OpenApiDocument> {
  if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
    return spec as OpenApiDocument;
  }
  if (typeof spec === 'string' && spec.length > 0) {
    if (/^https?:\/\//i.test(spec)) {
      const doFetch = fetchImpl ?? fetch;
      const res = await doFetch(spec);
      if (!res.ok) {
        throw new Error(
          `connector-openapi provider: connector '${connectorName}' failed to fetch spec '${spec}' (HTTP ${res.status}).`,
        );
      }
      return (await res.json()) as OpenApiDocument;
    }
    throw new Error(
      `connector-openapi provider: connector '${connectorName}' providerConfig.spec '${spec}' is not an http(s) URL. ` +
        `Provide an inline OpenAPI document object or an http(s) URL — file-path refs are resolved by the stack loader, not the connector.`,
    );
  }
  throw new Error(
    `connector-openapi provider: connector '${connectorName}' requires providerConfig.spec — an inline OpenAPI 3.x document object or an http(s) URL.`,
  );
}

/**
 * Build the `openapi` {@link ConnectorProviderFactory} (ADR-0096 / ADR-0023). At
 * boot the automation service invokes it for each `provider: 'openapi'`
 * declarative instance: it loads the OpenAPI document from `providerConfig.spec`,
 * then produces the same `{ def, handlers }` bundle {@link createOpenApiConnector}
 * generates for a hand-wired OpenAPI connector — one action per operation over a
 * static-auth HTTP transport, with the resolved `auth` applied.
 *
 * Hard-fails on invalid config (missing/unfetchable spec, no base URL), so a
 * misconfigured instance fails boot loudly.
 */
export function createOpenApiProviderFactory(deps: OpenApiProviderDeps = {}): ConnectorProviderFactory {
  return async (ctx) => {
    const cfg = (ctx.providerConfig ?? {}) as OpenApiProviderConfig;
    if (cfg.baseUrl !== undefined && typeof cfg.baseUrl !== 'string') {
      throw new Error(
        `connector-openapi provider: connector '${ctx.name}' providerConfig.baseUrl must be a string when set.`,
      );
    }
    const document = await loadOpenApiDocument(cfg.spec, deps.fetchImpl, ctx.name);
    const auth = ctx.auth as ResolvedConnectorAuth | undefined as RestAuth | undefined;
    return createOpenApiConnector({
      name: ctx.name,
      label: ctx.label,
      description: ctx.description,
      document,
      baseUrl: typeof cfg.baseUrl === 'string' ? cfg.baseUrl : undefined,
      auth,
      fetchImpl: deps.fetchImpl,
    });
  };
}

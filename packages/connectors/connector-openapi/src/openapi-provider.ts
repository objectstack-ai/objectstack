// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  ConnectorProviderContext,
  ConnectorProviderFactory,
  ResolvedConnectorAuth,
} from '@objectstack/spec/integration';
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
  /**
   * The OpenAPI 3.x document: an inline object, an http(s) URL to fetch at
   * boot, or a file path resolved relative to the declaring stack/package root
   * (`'./billing-openapi.json'`, #3016).
   */
  spec?: unknown;
  /** Override the base URL (else the document's `servers[0].url`). */
  baseUrl?: unknown;
}

/**
 * Resolve `providerConfig.spec` into a parsed OpenAPI document (ADR-0096;
 * union per #3016): an inline document object (the reliable, no-I/O-at-boot
 * form used by the showcase), an http(s) URL fetched at materialization, or a
 * **file path** read through the host's `ctx.loadPackageFile` — which resolves
 * it relative to the declaring stack/package root and confines the read to
 * that root (absolute / `..`-escaping paths are rejected there). Every failure
 * throws, so the materializer's reconcile policy applies: fatal at boot, the
 * entry is skipped on reload.
 */
async function loadOpenApiDocument(
  spec: unknown,
  fetchImpl: typeof fetch | undefined,
  ctx: ConnectorProviderContext,
): Promise<OpenApiDocument> {
  const connectorName = ctx.name;
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
    // File path — dereferenced through the host capability so resolution stays
    // anchored to (and confined within) the declaring stack/package root.
    if (!ctx.loadPackageFile) {
      throw new Error(
        `connector-openapi provider: connector '${connectorName}' providerConfig.spec '${spec}' is a file path, ` +
          `but this host provides no package file access — inline the OpenAPI document or use an http(s) URL.`,
      );
    }
    let text: string;
    try {
      text = await ctx.loadPackageFile(spec);
    } catch (err) {
      throw new Error(
        `connector-openapi provider: connector '${connectorName}' failed to read providerConfig.spec '${spec}': ` +
          `${(err as Error).message}`,
      );
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not a JSON object');
      }
      return parsed as OpenApiDocument;
    } catch (err) {
      throw new Error(
        `connector-openapi provider: connector '${connectorName}' providerConfig.spec '${spec}' is not a parseable ` +
          `OpenAPI JSON document: ${(err as Error).message}`,
      );
    }
  }
  throw new Error(
    `connector-openapi provider: connector '${connectorName}' requires providerConfig.spec — an inline OpenAPI 3.x ` +
      `document object, an http(s) URL, or a package-relative file path.`,
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
    const document = await loadOpenApiDocument(cfg.spec, deps.fetchImpl, ctx);
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

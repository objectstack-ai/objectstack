// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  ConnectorProviderContext,
  ConnectorProviderFactory,
  ResolvedConnectorAuth,
} from '@objectstack/spec/integration';
import { ConnectorUpstreamUnavailableError } from '@objectstack/spec/integration';
import {
  createOpenApiConnector,
  type OpenApiDocument,
  type RestAuth,
} from './openapi-connector.js';

/**
 * The provider key this package contributes (ADR-0097). A declarative
 * `connectors:` entry with `provider: 'openapi'` is materialized by this factory.
 */
export const OPENAPI_PROVIDER_KEY = 'openapi';

/**
 * HTTP statuses treated as **transient** when fetching a remote spec at boot
 * (#3049 follow-up): a timeout / rate-limit / 5xx means the spec endpoint is
 * momentarily unhealthy, not that the connector is misconfigured — so the
 * instance degrades and retries rather than aborting boot. Mirrors the
 * connector request-retry convention (`retryableStatusCodes` default in
 * `ConnectorSchema`). Any OTHER non-2xx (400 / 401 / 403 / 404 / 410 …) means
 * the request itself is wrong — a configuration fault that stays fatal.
 */
const SPEC_FETCH_RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

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
   *
   * A remote URL that is unreachable / transiently failing (network error,
   * 408 / 429 / 5xx) degrades the instance and retries (#3049); a wrong URL
   * (non-retryable 4xx) or an unparseable document stays a fatal config fault.
   */
  spec?: unknown;
  /** Override the base URL (else the document's `servers[0].url`). */
  baseUrl?: unknown;
}

/**
 * Resolve `providerConfig.spec` into a parsed OpenAPI document (ADR-0097;
 * union per #3016): an inline document object (the reliable, no-I/O-at-boot
 * form used by the showcase), an http(s) URL fetched at materialization, or a
 * **file path** read through the host's `ctx.loadPackageFile` — which resolves
 * it relative to the declaring stack/package root and confines the read to
 * that root (absolute / `..`-escaping paths are rejected there).
 *
 * Fault classification (#3049 seam, symmetric with connector-mcp's connect
 * path): a remote spec URL that is unreachable or transiently failing throws
 * {@link ConnectorUpstreamUnavailableError} — the materializer degrades the
 * instance and retries. Every OTHER failure (missing spec, a wrong URL,
 * an unparseable document, no host file access) throws a plain error, which
 * stays fatal at boot / a skipped entry on reload.
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
      let res: Response;
      try {
        res = await doFetch(spec);
      } catch (err) {
        // The spec endpoint is unreachable — DNS / connection refused /
        // timeout / network error. Operational, not a config mistake: degrade
        // + retry rather than fail boot.
        throw new ConnectorUpstreamUnavailableError(
          `connector-openapi provider: connector '${connectorName}' could not reach spec URL '${spec}': ${(err as Error).message}`,
          { cause: err },
        );
      }
      if (!res.ok) {
        if (SPEC_FETCH_RETRYABLE_STATUS.has(res.status)) {
          // A transient server-side status (timeout / rate-limit / 5xx) — the
          // endpoint is momentarily unhealthy, so treat it as upstream-unavailable.
          throw new ConnectorUpstreamUnavailableError(
            `connector-openapi provider: connector '${connectorName}' got a transient HTTP ${res.status} fetching spec '${spec}'.`,
          );
        }
        // A non-retryable status (400 / 401 / 403 / 404 / 410 …) — the request
        // is wrong (bad URL, missing/insufficient auth for the spec endpoint):
        // a configuration fault that stays fatal.
        throw new Error(
          `connector-openapi provider: connector '${connectorName}' failed to fetch spec '${spec}' (HTTP ${res.status}).`,
        );
      }
      // A 2xx with an unparseable / non-object body is a content fault (the
      // endpoint served the wrong thing) — fatal, symmetric with the file-path
      // parse below.
      try {
        const parsed: unknown = await res.json();
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('not a JSON object');
        }
        return parsed as OpenApiDocument;
      } catch (err) {
        throw new Error(
          `connector-openapi provider: connector '${connectorName}' fetched spec '${spec}' but it is not a parseable ` +
            `OpenAPI JSON document: ${(err as Error).message}`,
        );
      }
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
 * Build the `openapi` {@link ConnectorProviderFactory} (ADR-0097 / ADR-0023). At
 * boot the automation service invokes it for each `provider: 'openapi'`
 * declarative instance: it loads the OpenAPI document from `providerConfig.spec`,
 * then produces the same `{ def, handlers }` bundle {@link createOpenApiConnector}
 * generates for a hand-wired OpenAPI connector — one action per operation over a
 * static-auth HTTP transport, with the resolved `auth` applied.
 *
 * Hard-fails on invalid config (missing spec, a wrong spec URL, an unparseable
 * document, a bad base URL), so a misconfigured instance fails boot loudly. A
 * remote spec URL that is merely unreachable / transiently failing instead
 * degrades the instance and retries (#3049) — see {@link loadOpenApiDocument}.
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
      // ADR-0049 · #18975 — the authored resilience policy, already resolved by
      // the materializer, reaches the transport this bundle closes over.
      retryConfig: ctx.retryConfig,
      requestTimeoutMs: ctx.requestTimeoutMs,
      fetchImpl: deps.fetchImpl,
    });
  };
}

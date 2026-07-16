// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ConnectorProviderFactory, ResolvedConnectorAuth } from '@objectstack/spec/integration';
import { createRestConnector, type RestAuth } from './rest-connector.js';

/**
 * The provider key this package contributes (ADR-0096). A declarative
 * `connectors:` entry with `provider: 'rest'` is materialized by this factory.
 */
export const REST_PROVIDER_KEY = 'rest';

/** Injectable dependencies for {@link createRestProviderFactory} (tests). */
export interface RestProviderDeps {
  /** Injected fetch implementation; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/** Shape of `providerConfig` for a `provider: 'rest'` declarative instance. */
interface RestProviderConfig {
  baseUrl?: unknown;
  defaultHeaders?: unknown;
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string');
}

/**
 * Build the `rest` {@link ConnectorProviderFactory} (ADR-0096). At boot the
 * automation service invokes it for each `provider: 'rest'` declarative instance,
 * turning `providerConfig.baseUrl` (+ the resolved `auth`) into the same
 * `{ def, handlers }` bundle {@link createRestConnector} produces for a
 * hand-wired REST connector — one `request` action over static-auth HTTP.
 *
 * Hard-fails on invalid config (missing `baseUrl`), so a misconfigured instance
 * fails boot loudly rather than materializing a dead connector.
 */
export function createRestProviderFactory(deps: RestProviderDeps = {}): ConnectorProviderFactory {
  return (ctx) => {
    const cfg = (ctx.providerConfig ?? {}) as RestProviderConfig;
    if (typeof cfg.baseUrl !== 'string' || cfg.baseUrl.length === 0) {
      throw new Error(
        `connector-rest provider: connector '${ctx.name}' requires providerConfig.baseUrl (a non-empty string, e.g. https://api.example.com).`,
      );
    }
    if (cfg.defaultHeaders !== undefined && !isStringRecord(cfg.defaultHeaders)) {
      throw new Error(
        `connector-rest provider: connector '${ctx.name}' providerConfig.defaultHeaders must be a string→string map.`,
      );
    }
    // `ResolvedConnectorAuth` is exactly the static-auth subset RestAuth expects
    // (the credentialRef has already been resolved to a secret upstream).
    const auth = ctx.auth as ResolvedConnectorAuth | undefined as RestAuth | undefined;
    return createRestConnector({
      name: ctx.name,
      label: ctx.label,
      baseUrl: cfg.baseUrl,
      auth,
      defaultHeaders: isStringRecord(cfg.defaultHeaders) ? cfg.defaultHeaders : undefined,
      fetchImpl: deps.fetchImpl,
    });
  };
}

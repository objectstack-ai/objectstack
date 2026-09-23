// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Connector, RetryConfigParsed } from './connector.zod';
import type { ResolvedConnectorAuth } from '../shared/connector-auth.zod';

/**
 * Connector **provider** contract (ADR-0097).
 *
 * A provider is a *generic executor* — `openapi` (ADR-0023), `mcp` (ADR-0024),
 * `rest`, … — contributed by a connector plugin as a **factory**. At boot the
 * automation service resolves each declarative provider-bound `connectors:`
 * entry by invoking the matching factory, which turns the entry's declarative
 * inputs into the same `{ def, handlers }` bundle a hand-written connector hands
 * to `registerConnector`. The registry, the `connector_action` node, and the
 * `GET /connectors` discovery route then see a finished connector — they never
 * know it was materialized from stack metadata (ADR-0097 §2).
 *
 * These are pure types (no logic — Prime Directive #2) so a connector plugin can
 * implement a provider factory depending only on `@objectstack/spec`, with no
 * runtime coupling to `@objectstack/service-automation` (mirrors how the plugins
 * already avoid importing the engine, using a structural registry surface).
 */

/**
 * A single materialized connector action handler. Receives the input the
 * `connector_action` node mapped from the flow, ignores the dispatch context
 * (materialized handlers close over their own transport), and returns the
 * action output. Structurally identical to the handler map the generator APIs
 * already produce (`createOpenApiConnector` / `createRestConnector` / MCP).
 */
export type ConnectorMaterializationHandler = (
  input: Record<string, unknown>,
  ctx: unknown,
) => Promise<Record<string, unknown>>;

/**
 * The result of materializing a provider-bound instance: the validated
 * {@link Connector} definition, a handler per action, and an optional `close`
 * for connectors that hold a live resource (an MCP connection, a pooled client)
 * so the automation service can tear it down on shutdown.
 */
export interface ConnectorMaterialization {
  def: Connector;
  handlers: Record<string, ConnectorMaterializationHandler>;
  close?: () => void | Promise<void>;
}

/**
 * Context handed to a {@link ConnectorProviderFactory} for one declarative
 * entry. Carries the entry's identity — the materialized def MUST adopt `name`
 * so the registry, `connector_action`, and the conflict rule all agree — the
 * provider-specific `providerConfig` (the factory validates its own shape), and
 * the `auth` already **resolved** from the entry's `credentialRef` through the
 * secrets/env layer, so the factory receives a usable static credential rather
 * than a raw reference (`undefined` when the entry declares no auth).
 *
 * It also carries the entry's **resilience policy** — `retryConfig`,
 * `connectionTimeoutMs`, `requestTimeoutMs` — so a provider that performs its
 * own I/O can honour what the author declared. Before that, those keys were
 * parsed and then reached nothing: a factory was never handed them and had no
 * way to honour them, which is what `packages/spec/liveness/connector.json`
 * recorded as `dead`.
 */
export interface ConnectorProviderContext {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: string;
  readonly type: string;
  readonly providerConfig: Record<string, unknown>;
  readonly auth?: ResolvedConnectorAuth;
  /**
   * The entry's declared retry policy, **resolved** — the host parses it so the
   * schema's defaults (`maxAttempts: 3`, `[408, 429, 500, 502, 503, 504]`, …)
   * are already applied and a factory reads real values rather than re-deriving
   * them. `undefined` when the entry declares none.
   *
   * A factory that performs its own I/O honours it by handing this (and
   * {@link requestTimeoutMs}) to `connectorFetchOptions()` →
   * `resilientFetch()`; the built-in HTTP providers do exactly that, which is
   * what makes the keys live rather than merely carried.
   */
  readonly retryConfig?: RetryConfigParsed;
  /**
   * The entry's declared connect deadline (ms), carried verbatim.
   *
   * ⚠️ **Carried, not enforced by the built-in HTTP path** — a WHATWG `fetch`
   * exposes one `AbortSignal` for the whole operation and never the connection
   * phase alone, so the platform has nowhere to apply a connect-only bound and
   * deliberately does not pretend otherwise (see
   * `connector-fetch-policy.ts`). It is handed over because a custom provider
   * on a transport that CAN separate the phases (a database client, a pooled
   * socket) is able to honour it; `packages/spec/liveness/connector.json`
   * records the platform side as `dead` for that reason.
   */
  readonly connectionTimeoutMs?: number;
  /**
   * The entry's declared per-request deadline (ms). The built-in HTTP path
   * applies it as `resilientFetch`'s per-attempt timeout.
   */
  readonly requestTimeoutMs?: number;
  /**
   * Host-injected package file reader (#3016, ADR-0097 follow-up). Resolves a
   * **relative** path against the root of the stack/package that declared the
   * entry and returns the file's UTF-8 text, so a factory can support file-path
   * refs like `providerConfig.spec: './billing-openapi.json'` without owning
   * filesystem access itself. The host confines reads to the package root:
   * absolute paths and `..`-escaping paths are rejected (throws). Missing /
   * unreadable files also throw, which the materializer's reconcile policy
   * turns into a hard boot error (fatal) or a skipped entry (reload).
   * `undefined` on hosts without a filesystem (edge/browser kernels) — a
   * factory needing a file must then fail with a clear message.
   */
  readonly loadPackageFile?: (relativePath: string) => Promise<string>;
}

/**
 * A provider factory contributed by a connector plugin under a provider key.
 * Invoked once per declarative instance at boot; may be async (loading a spec
 * document, opening a connection). Throwing is a **hard boot error** — invalid
 * `providerConfig`, an unresolvable credential, etc. surface loudly rather than
 * yielding a silently-dead connector (ADR-0097 §Decision). One exception
 * (#3017): a throw carrying the `CONNECTOR_UPSTREAM_UNAVAILABLE` code (see
 * `connector-provider-errors.ts`) marks an *operational* fault — the upstream
 * the factory must contact is temporarily unreachable — which the materializer
 * degrades and retries instead of failing boot.
 */
export type ConnectorProviderFactory = (
  ctx: ConnectorProviderContext,
) => ConnectorMaterialization | Promise<ConnectorMaterialization>;

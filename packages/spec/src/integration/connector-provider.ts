// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Connector } from './connector.zod';
import type { ResolvedConnectorAuth } from '../shared/connector-auth.zod';

/**
 * Connector **provider** contract (ADR-0096).
 *
 * A provider is a *generic executor* — `openapi` (ADR-0023), `mcp` (ADR-0024),
 * `rest`, … — contributed by a connector plugin as a **factory**. At boot the
 * automation service resolves each declarative provider-bound `connectors:`
 * entry by invoking the matching factory, which turns the entry's declarative
 * inputs into the same `{ def, handlers }` bundle a hand-written connector hands
 * to `registerConnector`. The registry, the `connector_action` node, and the
 * `GET /connectors` discovery route then see a finished connector — they never
 * know it was materialized from stack metadata (ADR-0096 §2).
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
 */
export interface ConnectorProviderContext {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: string;
  readonly type: string;
  readonly providerConfig: Record<string, unknown>;
  readonly auth?: ResolvedConnectorAuth;
}

/**
 * A provider factory contributed by a connector plugin under a provider key.
 * Invoked once per declarative instance at boot; may be async (loading a spec
 * document, opening a connection). Throwing is a **hard boot error** — invalid
 * `providerConfig`, an unreachable upstream, etc. surface loudly rather than
 * yielding a silently-dead connector (ADR-0096 §Decision).
 */
export type ConnectorProviderFactory = (
  ctx: ConnectorProviderContext,
) => ConnectorMaterialization | Promise<ConnectorMaterialization>;

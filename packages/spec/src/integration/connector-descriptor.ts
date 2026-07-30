// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Connector **registry** vocabulary — how a connector reached the registry,
 * whether it can dispatch, and the designer-facing view of it that
 * `GET /api/v1/automation/connectors` serves (ADR-0022, ADR-0097 §4, #3017).
 *
 * These sit beside the provider contract (`connector-provider.ts`) for the same
 * reason it lives here: they are pure types (no logic — Prime Directive #2), so
 * a connector plugin, a designer client, or the HTTP dispatcher can speak about
 * registered connectors depending only on `@objectstack/spec`, with no runtime
 * coupling to `@objectstack/service-automation`.
 *
 * [#4127] They were declared in the engine, which put the return type of a
 * *service-contract* method inside one implementation of that contract — so the
 * contract could not name it, `IAutomationService` never declared
 * `getConnectorDescriptors`, and the dispatcher route that serves it had to
 * duck-type the method and then re-type the result as `any` to filter on
 * `type`. The declaration moved here; the engine imports it back.
 */

/**
 * How a registered connector reached the engine (ADR-0097 §4). `plugin` — a
 * connector plugin called `registerConnector` directly (ADR-0018 §Addendum).
 * `declarative` — the automation service materialized a provider-bound
 * `connectors:` stack entry at boot. A name registered under one origin cannot
 * be re-registered under the other: that two-sources-of-truth collision is a
 * hard error, not a silent replace.
 */
export type ConnectorOrigin = 'plugin' | 'declarative';

/**
 * Whether a registered connector is dispatchable (#3017). `ready` — the normal
 * state: actions and handlers are live. `degraded` — a declarative instance
 * whose provider factory could not reach its upstream (e.g. an MCP server was
 * unreachable at boot): it is registered so `GET /connectors` shows it honestly
 * instead of it silently missing, but it exposes no actions and every dispatch
 * fails with a clear error until the materializer's retry succeeds.
 */
export type ConnectorState = 'ready' | 'degraded';

/**
 * A designer-facing view of one connector action — identity + its JSON-Schema
 * input/output. The runtime handler is intentionally omitted; this is metadata.
 */
export interface ConnectorActionDescriptor {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
}

/**
 * A designer-facing descriptor for a registered connector: its identity plus
 * the actions it exposes. Served by `GET /api/v1/automation/connectors` so the
 * flow designer can populate the `connector_action` node's connector → action
 * → input pickers (ADR-0018 §Addendum, ADR-0022). Mirrors `ActionDescriptor`'s
 * role for node types, but for the connector registry.
 */
export interface ConnectorDescriptor {
  readonly name: string;
  readonly label: string;
  /**
   * The connector's category (`saas`, `database`, `rest`, …) — the same `type`
   * the authorable {@link Connector} declares. `GET /connectors?type=` filters
   * on it.
   */
  readonly type: string;
  readonly description?: string;
  readonly icon?: string;
  readonly actions: ConnectorActionDescriptor[];
  /**
   * How the connector reached the registry (ADR-0097 §4): `plugin` — registered
   * by a connector plugin via `registerConnector`; `declarative` — materialized
   * from a provider-bound `connectors:` stack entry at boot. Lets a designer
   * distinguish a live declarative instance from a plugin connector (and both
   * from an inert catalog descriptor, which never reaches this list).
   */
  readonly origin: ConnectorOrigin;
  /**
   * Dispatchability (#3017): `ready` — actions are live; `degraded` — the
   * instance's upstream was unreachable when the provider factory ran, so it
   * currently exposes no actions and cannot dispatch. The platform retries
   * degraded instances automatically; `degradedReason` says what failed.
   */
  readonly state: ConnectorState;
  /** Why the connector is degraded — present only when `state` is `degraded`. */
  readonly degradedReason?: string;
}

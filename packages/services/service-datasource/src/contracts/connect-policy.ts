// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DatasourceConnectPolicy — host-injectable gate consulted *before*
 * {@link DatasourceConnectionService} builds and registers a live driver
 * (ADR-0062 D1/D5, and the epic #2163 "connect-policy seam" note).
 *
 * The framework ships a permissive default ({@link allowAllConnectPolicy}) so a
 * self-hosted single-environment runtime connects external datasources out of
 * the box (subject to the D2 auto-connect gate, which is applied separately by
 * {@link DatasourceConnectionService.connectDeclared}). A multi-tenant host
 * (shared-container cloud) binds a stricter policy that can *fail-close* on the
 * shared runtime — e.g. checking `sys_environment.plan`, an egress allow-list,
 * and per-tenant quota — to enforce SSRF / egress isolation.
 *
 * This keeps a single connect path for code- and runtime-origin datasources
 * (D1): the host injects a policy rather than forking a second connect path.
 * No plan coupling lives in the open framework.
 */

/** Why a connect is being attempted — lets a policy treat origins differently. */
export interface DatasourceConnectContext {
  /** Provenance of the datasource being connected. */
  origin?: 'code' | 'runtime';
  /**
   * What triggered this connect:
   *  - `declared-auto`  — code-defined datasource auto-connected at boot (D2 gate passed).
   *  - `runtime-admin`  — UI "Add/Update Datasource" hot pool registration.
   *  - `rehydrate`      — boot rehydration of a persisted runtime datasource.
   */
  trigger?: 'declared-auto' | 'runtime-admin' | 'rehydrate';
}

/** A policy verdict. `allow:false` leaves the datasource unconnected (metadata-only). */
export interface DatasourceConnectDecision {
  allow: boolean;
  /** Human-readable reason, surfaced in logs when a connect is denied. */
  reason?: string;
}

/** The minimal datasource shape a policy inspects (never a secret). */
export interface DatasourceConnectSubject {
  name: string;
  driver: string;
  schemaMode?: 'managed' | 'external' | 'validate-only';
  external?: Record<string, unknown>;
}

/** Host-provided policy gate consulted before opening a connection. */
export interface DatasourceConnectPolicy {
  /**
   * Decide whether `ds` may be connected. Sync or async. Throwing is treated
   * as a denial (fail-closed) by {@link DatasourceConnectionService}.
   */
  canConnect(
    ds: DatasourceConnectSubject,
    ctx?: DatasourceConnectContext,
  ): DatasourceConnectDecision | Promise<DatasourceConnectDecision>;
}

/**
 * Open-core default: allow every connect. The D2 auto-connect gate (external /
 * explicitly-routed / `autoConnect:true`) still applies on top of this for
 * code-defined datasources, so a managed, unrouted datasource is never
 * connected even under the permissive policy.
 */
export const allowAllConnectPolicy: DatasourceConnectPolicy = {
  canConnect: () => ({ allow: true }),
};

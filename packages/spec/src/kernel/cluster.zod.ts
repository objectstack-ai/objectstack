// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * # Cluster Protocol
 *
 * Defines the runtime semantics required for ObjectStack to behave correctly
 * when more than one Node.js process is involved. The protocol layer codifies
 * **intent** (scope, delivery, leadership); concrete implementations
 * (`memory`, `redis`, `postgres`, `nats`) live in `@objectstack/service-cluster`.
 *
 * The full design rationale is in
 * `content/docs/kernel/cluster.mdx`. Read it before changing
 * any of the enums here — every value has a precise contract that other
 * subsystems depend on.
 */

// ==========================================================================
// Event Scope & Delivery Semantics
// ==========================================================================

/**
 * Event Scope.
 *
 * Answers the question *"who is supposed to receive this event?"*. The
 * default (`local`) is the safe choice: it never crosses a process boundary,
 * so a plugin written without thinking about clustering still behaves
 * correctly on one or N nodes.
 *
 * - `local`  — In-process only. Cheap, lossy on crash, never crosses nodes.
 * - `cluster` — Delivered to every node, including the emitter. Used for
 *               cache invalidation, configuration reloads, metadata change
 *               notifications.
 * - `tenant`  — Same wire path as `cluster`, but transports may partition
 *               by tenant id so only nodes currently serving the tenant
 *               receive it.
 *
 * @see content/docs/kernel/cluster.mdx §4.1
 */
export const EventScopeSchema = z.enum(['local', 'cluster', 'tenant'])
  .describe('Where the event must be delivered: local process, whole cluster, or tenant-scoped.');

export type EventScope = z.infer<typeof EventScopeSchema>;

/**
 * Event Delivery Semantics.
 *
 * Answers *"what guarantee does the bus offer about reaching handlers?"*.
 *
 * - `best-effort`    — In-memory delivery, no persistence, lost on crash.
 *                      Default for `local`-scoped events.
 * - `at-least-once`  — Persisted to the transport before publish returns.
 *                      Survives node crash. Handlers MUST be idempotent —
 *                      duplicates are possible during retry. Default for
 *                      `cluster` / `tenant`-scoped events.
 * - `exactly-once`   — Reserved keyword. **Not implemented in v1**;
 *                      runtime will reject this value at startup with a
 *                      clear error. Accepted in the schema so future
 *                      runtimes can add it without a breaking change.
 *
 * @see content/docs/kernel/cluster.mdx §4.2
 */
export const EventDeliverySemanticsSchema = z.enum([
  'best-effort',
  'at-least-once',
  'exactly-once',
]).describe('Delivery guarantee offered by the transport.');

export type EventDeliverySemantics = z.infer<typeof EventDeliverySemanticsSchema>;

/**
 * Per-emit cluster options attached to `EventMetadata.cluster`.
 *
 * Adding the object as `optional()` everywhere preserves backward
 * compatibility — emits that omit it default to local + best-effort, which
 * is identical to today's behaviour.
 */
export const EventClusterOptionsSchema = lazySchema(() => z.object({
  /**
   * Where the event must be delivered.
   * @default 'local'
   */
  scope: EventScopeSchema.optional().default('local')
    .describe('Delivery scope. Default `local` for backward compatibility.'),

  /**
   * Delivery guarantee. For `local` scope the default is `best-effort`;
   * for `cluster` / `tenant` scopes the runtime upgrades the default to
   * `at-least-once` if the field is omitted.
   */
  deliverySemantics: EventDeliverySemanticsSchema.optional()
    .describe('Delivery guarantee. Default depends on scope.'),

  /**
   * Partition key for ordered delivery. Two events with the same
   * `partitionKey` are delivered to handlers in emit order even when
   * multiple consumers run in parallel. Different keys may interleave.
   *
   * Typical values: record id, tenant id, conversation id.
   */
  partitionKey: z.string().min(1).optional()
    .describe('Stable key that guarantees emit-order delivery for same-key events.'),
}).describe('Per-emit cluster routing & ordering options.'));

export type EventClusterOptions = z.infer<typeof EventClusterOptionsSchema>;

// ==========================================================================
// Service Cluster Scope & Leader Strategy
// ==========================================================================

/**
 * Cluster scope for a service registration.
 *
 * Independent of DI lifecycle scope (`singleton` / `transient` / `scoped`),
 * which controls *per-call* instance reuse. This controls *per-process*
 * presence: should every node run a copy, or only one node at a time?
 *
 * - `node`    — One instance per Node.js process. Every node runs a copy.
 *               This is the only safe default.
 * - `cluster` — Logically one instance across the whole cluster. Must
 *               declare a `leaderStrategy` for how the invariant is held.
 *
 * @see content/docs/kernel/cluster.mdx §5
 */
export const ServiceClusterScopeSchema = z.enum(['node', 'cluster'])
  .describe('Whether this service runs on every node or as a cluster singleton.');

export type ServiceClusterScope = z.infer<typeof ServiceClusterScopeSchema>;

/**
 * Strategy for maintaining the cluster-singleton invariant.
 *
 * Only meaningful when `clusterScope: 'cluster'`.
 *
 * - `leader-elected`        — Exactly one node holds a leadership lock; only
 *                             the leader runs the work. Use for cron-style
 *                             schedulers and migration runners.
 * - `partitioned`           — Every node runs the service, but each instance
 *                             owns a disjoint partition of the work
 *                             (typically hashed on `partitionKey`). Use for
 *                             high-throughput queue workers.
 * - `idempotent-broadcast`  — Every node runs the service on every input,
 *                             and the work itself is idempotent. Use for
 *                             cache invalidation and projection rebuilders.
 *
 * @see content/docs/kernel/cluster.mdx §5
 */
export const ServiceLeaderStrategySchema = z.enum([
  'leader-elected',
  'partitioned',
  'idempotent-broadcast',
]).describe('How the cluster-singleton invariant is enforced at runtime.');

export type ServiceLeaderStrategy = z.infer<typeof ServiceLeaderStrategySchema>;

/**
 * Cluster annotations on a service registration.
 *
 * Embedded as `cluster?: ServiceClusterAnnotations` on
 * `ServiceMetadata` / `ServiceFactoryRegistration`. Omitting it is
 * equivalent to `{ clusterScope: 'node' }`.
 */
export const ServiceClusterAnnotationsSchema = lazySchema(() => z.object({
  /**
   * Where the service runs in a cluster.
   * @default 'node'
   */
  clusterScope: ServiceClusterScopeSchema.optional().default('node')
    .describe('Per-node vs cluster-singleton presence.'),

  /**
   * Required when `clusterScope === 'cluster'`. Ignored otherwise.
   * Validation of this requirement is performed at runtime by the kernel,
   * not at parse time, so that legacy registrations without the field
   * continue to parse cleanly.
   */
  leaderStrategy: ServiceLeaderStrategySchema.optional()
    .describe('How the cluster-singleton invariant is maintained.'),

  /**
   * Optional cluster-wide identifier for the service. Defaults to the
   * service `name`. Set this when two physically different services need
   * to share the same leadership lock (e.g. for safe rolling upgrades).
   */
  clusterId: z.string().min(1).optional()
    .describe('Logical cluster identity used for leader election (defaults to service name).'),
}).describe('Service-registration annotations governing cluster behaviour.'));

export type ServiceClusterAnnotations = z.infer<typeof ServiceClusterAnnotationsSchema>;

// ==========================================================================
// Cluster Capability (top-level stack config)
// ==========================================================================

/**
 * Cluster driver identifier.
 *
 * Selects which transport implements the four primitives (PubSub, Lock,
 * KV, Counter). The protocol enumerates the drivers we expect to ship;
 * additional drivers can be registered at runtime by plugins.
 *
 * @see content/docs/kernel/cluster.mdx §8
 */
export const ClusterDriverSchema = z.enum([
  'memory',    // single-process; in-EventEmitter + Map + mutex + int
  'redis',     // Redis Pub/Sub + SETNX-with-TTL + GET/SET + INCR
  'postgres',  // LISTEN/NOTIFY + advisory locks + KV table + sequence
  'nats',      // NATS subjects + KV bucket lock + KV bucket + KV INCR
  'custom',    // Plugin-provided driver; runtime looks it up by name.
]).describe('Cluster transport driver.');

export type ClusterDriver = z.infer<typeof ClusterDriverSchema>;

/**
 * Tenant isolation strategy on shared transports.
 *
 * - `channel-prefix` — Transport channels / keys are namespaced by
 *                      `tenantId` so two tenants on the same Redis cluster
 *                      cannot see each other's traffic. Default.
 * - `none`           — No isolation. Only safe for single-tenant
 *                      deployments or where the tenant is encoded
 *                      directly into the payload.
 */
export const ClusterTenantIsolationSchema = z.enum(['channel-prefix', 'none'])
  .describe('How tenant traffic is separated on shared transports.');

export type ClusterTenantIsolation = z.infer<typeof ClusterTenantIsolationSchema>;

/**
 * Cluster configuration block on `defineStack({ cluster })`.
 *
 * The entire field is optional. When omitted the kernel uses the `memory`
 * driver — identical to today's behaviour — and logs a one-line warning
 * in production mode so deployments know they are not horizontally safe.
 *
 * @example
 * ```ts
 * defineStack({
 *   cluster: {
 *     driver: 'postgres',
 *     useExistingPool: true,
 *     nodeId: process.env.NODE_ID,
 *   },
 * })
 * ```
 */
export const ClusterCapabilityConfigSchema = lazySchema(() => z.object({
  /**
   * Transport driver. Defaults to `memory` (single-process). Production
   * deployments must override this to a distributed driver.
   * @default 'memory'
   */
  driver: ClusterDriverSchema.optional().default('memory')
    .describe('Cluster transport driver. Defaults to in-memory single-process.'),

  /**
   * Driver-specific connection string. Required for `redis` and `nats`,
   * optional for `postgres` (defaults to the main DB pool when
   * `useExistingPool` is true).
   */
  url: z.string().url().optional()
    .describe('Driver-specific connection URL.'),

  /**
   * When `driver === 'postgres'`, reuse the main application database
   * pool instead of opening a dedicated one. Recommended for small/medium
   * deployments — zero new infrastructure.
   * @default true
   */
  useExistingPool: z.boolean().optional().default(true)
    .describe('Reuse the main DB pool for the postgres driver.'),

  /**
   * Stable identifier for this node. Used by leader election and trace
   * correlation. Auto-generated (UUIDv4) if absent; setting it explicitly
   * makes logs and lock owners human-readable.
   */
  nodeId: z.string().min(1).optional()
    .describe('Stable node identifier. Auto-generated when absent.'),

  /**
   * Leader-election heartbeat interval in milliseconds. The lock TTL must
   * be ≥ 3× this value; the runtime validates the ratio at startup.
   * @default 5000
   */
  heartbeatMs: z.number().int().min(100).optional().default(5000)
    .describe('Leader-election heartbeat interval in milliseconds.'),

  /**
   * Lock time-to-live in milliseconds. Safe ratio is 3× `heartbeatMs`.
   * Shorter TTLs recover faster from crashed leaders but risk flapping
   * under transient network slowness.
   * @default 15000
   */
  lockTtlMs: z.number().int().min(100).optional().default(15000)
    .describe('Leader-election lock TTL in milliseconds (≥ 3× heartbeatMs).'),

  /**
   * Tenant isolation strategy on shared transports.
   * @default 'channel-prefix'
   */
  tenantIsolation: ClusterTenantIsolationSchema.optional().default('channel-prefix')
    .describe('Channel/key namespacing strategy for multi-tenant deployments.'),

  /**
   * Per-driver options passed verbatim to the driver implementation.
   * The protocol does not validate these — drivers do.
   */
  driverOptions: z.record(z.string(), z.unknown()).optional()
    .describe('Driver-specific opaque options.'),
}).describe('Cluster capability configuration for the stack.'));

export type ClusterCapabilityConfig = z.infer<typeof ClusterCapabilityConfigSchema>;
export type ClusterCapabilityConfigInput = z.input<typeof ClusterCapabilityConfigSchema>;

// ==========================================================================
// Metadata Change Event Payload
// ==========================================================================

/**
 * Operation that triggered a `metadata:changed` event.
 */
export const MetadataChangeOperationSchema = z.enum([
  'create',
  'update',
  'delete',
  'publish',
]).describe('Persistence operation that triggered the change.');

export type MetadataChangeOperation = z.infer<typeof MetadataChangeOperationSchema>;

/**
 * Canonical payload for the `metadata:changed` event.
 *
 * All metadata persistence layers MUST emit this event after any successful
 * write. Readers (registry caches, query engines, REST routers) MUST
 * subscribe to it and compare `version` with their cached value before
 * applying the invalidation — out-of-order older versions are ignored.
 *
 * @see content/docs/kernel/cluster.mdx §6
 */
export const MetadataChangedEventPayloadSchema = lazySchema(() => z.object({
  /**
   * Metadata type — e.g. `'object'`, `'view'`, `'flow'`, `'agent'`.
   * Matches the `MetadataTypeSchema` enum.
   */
  type: z.string().min(1).describe('Metadata type (e.g. "object", "view").'),

  /**
   * Machine name of the changed item.
   */
  name: z.string().min(1).describe('Machine name of the metadata item.'),

  /**
   * Tenant scope when the change is tenant-overlaid. Absent for
   * platform-default metadata.
   */
  tenantId: z.string().optional().describe('Tenant id when the change is overlay-scoped.'),

  /**
   * Monotonic version of the record after the change. Readers compare
   * this with their cached value; only strictly greater versions
   * invalidate.
   *
   * Modelled as `bigint` in the schema to support long-running clusters
   * without 32-bit wraparound concerns; persisted as `numeric` / `int8`
   * in storage.
   */
  version: z.bigint().describe('Monotonic version of the record after the change.'),

  /**
   * The operation that produced this version.
   */
  operation: MetadataChangeOperationSchema,

  /**
   * Optional correlation id for tracing the change back to a request /
   * deploy / migration that produced it.
   */
  correlationId: z.string().optional()
    .describe('Trace correlation id of the originating request.'),
}).describe('Canonical payload for the metadata:changed cluster event.'));

export type MetadataChangedEventPayload = z.infer<typeof MetadataChangedEventPayloadSchema>;

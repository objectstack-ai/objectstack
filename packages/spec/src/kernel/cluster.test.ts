// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  EventScopeSchema,
  EventDeliverySemanticsSchema,
  EventClusterOptionsSchema,
  ServiceClusterScopeSchema,
  ServiceLeaderStrategySchema,
  ServiceClusterAnnotationsSchema,
  ClusterDriverSchema,
  ClusterCapabilityConfigSchema,
} from './cluster.zod';
import { EventMetadataSchema } from './events/core.zod';
import { ServiceMetadataSchema, ServiceFactoryRegistrationSchema } from './service-registry.zod';

describe('cluster.zod', () => {
  describe('EventScope', () => {
    it('accepts local, cluster, tenant', () => {
      expect(EventScopeSchema.parse('local')).toBe('local');
      expect(EventScopeSchema.parse('cluster')).toBe('cluster');
      expect(EventScopeSchema.parse('tenant')).toBe('tenant');
    });
    it('rejects unknown scope', () => {
      expect(() => EventScopeSchema.parse('global')).toThrow();
    });
  });

  describe('EventDeliverySemantics', () => {
    it('accepts the three semantic levels including reserved exactly-once', () => {
      expect(EventDeliverySemanticsSchema.parse('best-effort')).toBe('best-effort');
      expect(EventDeliverySemanticsSchema.parse('at-least-once')).toBe('at-least-once');
      // exactly-once must parse cleanly so we don't break forward-compat,
      // even though the runtime is expected to reject it at startup.
      expect(EventDeliverySemanticsSchema.parse('exactly-once')).toBe('exactly-once');
    });
  });

  describe('EventClusterOptions', () => {
    it('defaults scope to local when omitted', () => {
      const parsed = EventClusterOptionsSchema.parse({});
      expect(parsed.scope).toBe('local');
    });

    it('accepts a fully specified routing option', () => {
      const parsed = EventClusterOptionsSchema.parse({
        scope: 'cluster',
        deliverySemantics: 'at-least-once',
        partitionKey: 'acct_123',
      });
      expect(parsed).toEqual({
        scope: 'cluster',
        deliverySemantics: 'at-least-once',
        partitionKey: 'acct_123',
      });
    });

    it('rejects an empty partitionKey', () => {
      expect(() =>
        EventClusterOptionsSchema.parse({ scope: 'cluster', partitionKey: '' }),
      ).toThrow();
    });
  });

  describe('EventMetadata.cluster', () => {
    it('embeds cluster options optionally and preserves legacy emits', () => {
      // Legacy shape — no cluster field — still parses.
      const legacy = EventMetadataSchema.parse({
        source: 'plugin-x',
        timestamp: new Date().toISOString(),
      });
      expect(legacy.cluster).toBeUndefined();

      const enriched = EventMetadataSchema.parse({
        source: 'plugin-x',
        timestamp: new Date().toISOString(),
        cluster: { scope: 'cluster', deliverySemantics: 'at-least-once' },
      });
      expect(enriched.cluster?.scope).toBe('cluster');
    });
  });

  describe('ServiceClusterAnnotations', () => {
    it('defaults clusterScope to node when omitted', () => {
      const parsed = ServiceClusterAnnotationsSchema.parse({});
      expect(parsed.clusterScope).toBe('node');
    });

    it('parses a fully annotated cluster service', () => {
      const parsed = ServiceClusterAnnotationsSchema.parse({
        clusterScope: 'cluster',
        leaderStrategy: 'leader-elected',
        clusterId: 'cron-scheduler',
      });
      expect(parsed.leaderStrategy).toBe('leader-elected');
      expect(parsed.clusterId).toBe('cron-scheduler');
    });

    it('rejects unknown leader strategy', () => {
      expect(() =>
        ServiceClusterAnnotationsSchema.parse({
          clusterScope: 'cluster',
          leaderStrategy: 'gossip',
        }),
      ).toThrow();
    });
  });

  describe('ServiceMetadata / ServiceFactoryRegistration', () => {
    it('accepts cluster annotations on service metadata without breaking legacy shape', () => {
      const legacy = ServiceMetadataSchema.parse({ name: 'logger' });
      expect(legacy.cluster).toBeUndefined();

      const annotated = ServiceMetadataSchema.parse({
        name: 'cron-scheduler',
        cluster: {
          clusterScope: 'cluster',
          leaderStrategy: 'leader-elected',
        },
      });
      expect(annotated.cluster?.clusterScope).toBe('cluster');
    });

    it('accepts cluster annotations on service factory registration', () => {
      const parsed = ServiceFactoryRegistrationSchema.parse({
        name: 'webhook-dispatcher',
        cluster: {
          clusterScope: 'cluster',
          leaderStrategy: 'partitioned',
        },
      });
      expect(parsed.cluster?.leaderStrategy).toBe('partitioned');
    });
  });

  describe('ClusterCapabilityConfig', () => {
    it('parses an empty config with all defaults', () => {
      const parsed = ClusterCapabilityConfigSchema.parse({});
      expect(parsed.driver).toBe('memory');
      expect(parsed.heartbeatMs).toBe(5000);
      expect(parsed.lockTtlMs).toBe(15000);
      expect(parsed.tenantIsolation).toBe('channel-prefix');
      expect(parsed.useExistingPool).toBe(true);
    });

    it('parses a custom driver config', () => {
      const parsed = ClusterCapabilityConfigSchema.parse({
        driver: 'custom',
        nodeId: 'node-prod-1',
      });
      expect(parsed.driver).toBe('custom');
      expect(parsed.nodeId).toBe('node-prod-1');
    });

    it('parses a redis driver config with url', () => {
      const parsed = ClusterCapabilityConfigSchema.parse({
        driver: 'redis',
        url: 'redis://localhost:6379',
      });
      expect(parsed.driver).toBe('redis');
      expect(parsed.url).toBe('redis://localhost:6379');
    });

    it('enumerates exactly the drivers that ship plus custom', () => {
      // Pin the roster: a value must not re-enter this enum without an
      // implementation behind it (cloud#1626 ruling, 2026-08-24).
      expect(ClusterDriverSchema.options).toEqual(['memory', 'redis', 'custom']);
    });

    it('rejects the removed dangling drivers postgres and nats by name', () => {
      for (const removed of ['postgres', 'nats']) {
        const result = ClusterDriverSchema.safeParse(removed);
        expect(result.success).toBe(false);
        if (!result.success) {
          const issue = result.error.issues[0];
          // zod v4 invalid_value issue: `values` is the accept set — the
          // removed spelling must not be in it.
          expect(issue.code).toBe('invalid_value');
          expect((issue as { values?: unknown[] }).values).toEqual([
            'memory', 'redis', 'custom',
          ]);
        }
        const config = ClusterCapabilityConfigSchema.safeParse({ driver: removed });
        expect(config.success).toBe(false);
      }
    });

    it('rejects unknown driver', () => {
      expect(() =>
        ClusterDriverSchema.parse('etcd'),
      ).toThrow();
    });
  });

  describe('MetadataChangedEventPayload retirement (ADR-0049 enforce-or-remove)', () => {
    // Runtime namespace probes, the registry-retirement.test.ts pattern: a
    // removed export cannot be imported by name (would not compile), so the
    // pin asks the namespace object. The payload schema declared a MUST-emit /
    // MUST-subscribe `metadata:changed` contract that nothing ever produced or
    // consumed, and its `z.bigint()` version could not cross a JSON transport;
    // the `MetadataChangeOperationSchema` enum existed only to type its
    // `operation` field and left with it as the orphan value schema. ADR-0087:
    // `RETIRED_DEFS_BY_MAJOR[18]` + the D3 entry
    // `metadata-changed-event-payload-retired`. Anti-vacuity guard on each
    // probe: a neighbour that stayed.
    const RETIRED = [
      'MetadataChangedEventPayloadSchema',
      'MetadataChangeOperationSchema',
    ] as const;
    const SURVIVOR = 'ClusterCapabilityConfigSchema';

    it('the payload schema and its orphan operation enum are no longer exported from kernel/cluster.zod', async () => {
      const mod = (await import('./cluster.zod')) as unknown as Record<string, unknown>;
      for (const name of RETIRED) {
        expect(Object.prototype.hasOwnProperty.call(mod, name)).toBe(false);
      }
      // Anti-vacuity: the sibling that deliberately stayed still resolves.
      expect(Object.prototype.hasOwnProperty.call(mod, SURVIVOR)).toBe(true);
    });

    it('nor from the `@objectstack/spec/kernel` entry', async () => {
      const kernel = (await import('./index')) as unknown as Record<string, unknown>;
      for (const name of RETIRED) {
        expect(Object.prototype.hasOwnProperty.call(kernel, name)).toBe(false);
      }
      expect(Object.prototype.hasOwnProperty.call(kernel, SURVIVOR)).toBe(true);
    });
  });
});

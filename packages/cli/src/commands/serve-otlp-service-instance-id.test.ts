// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The OTLP resource `os serve` exports carries `service.instance.id` when
 * several replicas are declared over the redis cluster driver (cloud#3814 N5),
 * and is today's two-attribute resource on every other boot.
 *
 * Every case asks `serveOtlpResource`, the one builder the OTLP exporter in
 * `buildServeObservability` is constructed with, from the environment alone, so
 * the declaration is read by the same predicate the boot reads
 * (`declaresReplicasSharingState`). A second process is stood in for by a
 * second {@link ServeInstanceHost}: same host name, its own pid.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';
import { hostname } from 'node:os';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OtlpHttpMetricsRegistry } from '@objectstack/observability';
import { serveInstanceId, serveOtlpResource, type ServeInstanceHost } from './serve.js';

// Pay the first load of what `serve.ts` reaches through dynamic `import()`s at
// MODULE LOAD, outside any clocked case (`pnpm check:test-source-alias`).
import '@objectstack/metadata-protocol';
import '@objectstack/metadata';
import '@objectstack/objectql';
import '@objectstack/plugin-hono-server';
import '@objectstack/rest';
import '@objectstack/service-settings';
import '@objectstack/service-datasource';
import '@objectstack/driver-turso';
import '@objectstack/driver-sql';
import '@objectstack/platform-objects/plugin';
import '@objectstack/plugin-security';
// …and what it reaches through `start.ts` (`declaresReplicasSharingState`).
import '@objectstack/cloud-connection';

/** Today's resource, byte for byte: the CONTROL every undeclared boot must keep. */
const TODAY = JSON.stringify({ 'service.name': 'objectstack', 'deployment.environment': 'production' });

/** Two processes on one host. */
const replicaA: ServeInstanceHost = { hostname: () => 'node-7', pid: 101, randomId: () => 'random-a' };
const replicaB: ServeInstanceHost = { hostname: () => 'node-7', pid: 102, randomId: () => 'random-b' };

const DECLARED = [
  ['OS_EXPECT_MULTI_NODE=true over redis', { OS_EXPECT_MULTI_NODE: 'true', OS_CLUSTER_DRIVER: 'redis' }],
  ['OS_CLUSTER_REPLICAS=3 over redis', { OS_CLUSTER_REPLICAS: '3', OS_CLUSTER_DRIVER: 'redis' }],
] as const;

describe('serveOtlpResource — declared replicas export one instance id each', () => {
  it.each(DECLARED)('%s: two processes on one host export distinct ids', async (_label, env) => {
    const a = await serveOtlpResource({ ...env }, replicaA);
    const b = await serveOtlpResource({ ...env }, replicaB);
    expect(a['service.instance.id']).toBe('node-7-101');
    expect(b['service.instance.id']).toBe('node-7-102');
    expect(a['service.instance.id']).not.toBe(b['service.instance.id']);
    // The two attributes it always had are still there.
    expect(a['service.name']).toBe('objectstack');
    expect(a['deployment.environment']).toBe('production');
  });

  it('a host that reports no name falls back to a random id per process', async () => {
    const env = { OS_EXPECT_MULTI_NODE: 'true', OS_CLUSTER_DRIVER: 'redis' };
    const a = await serveOtlpResource(env, { ...replicaA, hostname: () => '  ' });
    const b = await serveOtlpResource(env, { ...replicaB, hostname: () => { throw new Error('uv_os_gethostname'); } });
    expect(a['service.instance.id']).toBe('random-a');
    expect(b['service.instance.id']).toBe('random-b');
  });

  it('the default host is this process: its host name and pid', () => {
    expect(serveInstanceId()).toBe(`${hostname().trim()}-${process.pid}`);
  });
});

describe('serveOtlpResource — CONTROL: every other boot exports today\'s resource unchanged', () => {
  it.each([
    ['nothing declared', {}],
    ['redis without a declaration', { OS_CLUSTER_DRIVER: 'redis' }],
    ['OS_CLUSTER_REPLICAS=1 over redis', { OS_CLUSTER_REPLICAS: '1', OS_CLUSTER_DRIVER: 'redis' }],
    ['declared over the in-process driver', { OS_EXPECT_MULTI_NODE: 'true', OS_CLUSTER_DRIVER: 'memory' }],
    ['declared with no cluster driver', { OS_CLUSTER_REPLICAS: '3' }],
  ] as const)('%s', async (_label, env) => {
    const resource = await serveOtlpResource({ ...env }, replicaA);
    expect(JSON.stringify(resource)).toBe(TODAY);
  });
});

describe('serveOtlpResource — the attribute reaches the OTLP wire', () => {
  let server: Server;
  let endpoint: string;
  const bodies: string[] = [];

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => { bodies.push(body); res.writeHead(200).end('{}'); });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  /** What one flush of an exporter built with this resource puts in `resource.attributes`. */
  async function exported(resource: Record<string, string>): Promise<Record<string, unknown>> {
    bodies.length = 0;
    const metrics = new OtlpHttpMetricsRegistry({ endpoint, resource });
    metrics.counter('probe_total');
    await metrics.flush();
    expect(bodies).toHaveLength(1);
    const attributes = JSON.parse(bodies[0]).resourceMetrics[0].resource.attributes as Array<{ key: string; value: { stringValue: string } }>;
    return Object.fromEntries(attributes.map((a) => [a.key, a.value.stringValue]));
  }

  it('two declared replicas on one host export distinct service.instance.id', async () => {
    const env = { OS_EXPECT_MULTI_NODE: 'true', OS_CLUSTER_DRIVER: 'redis' };
    const a = await exported(await serveOtlpResource(env, replicaA));
    const b = await exported(await serveOtlpResource(env, replicaB));
    expect(a['service.instance.id']).toBe('node-7-101');
    expect(b['service.instance.id']).toBe('node-7-102');
  });

  it('an undeclared boot exports no service.instance.id', async () => {
    const attributes = await exported(await serveOtlpResource({}, replicaA));
    expect(attributes).toEqual({ 'service.name': 'objectstack', 'deployment.environment': 'production' });
  });
});

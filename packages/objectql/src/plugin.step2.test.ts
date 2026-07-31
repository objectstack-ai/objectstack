// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0076 Step 2 (#2462) — delegated protocol assembly.
 *
 * `ObjectQLPlugin({ registerProtocol: false })` + `createMetadataProtocolPlugin()`
 * must produce the same service surface the built-in assembly does; mixing the
 * built-in assembly WITH the plugin must fail with the actionable message.
 * (This test lives in the objectql package: metadata-protocol must not depend
 * on objectql, even as a devDependency — turbo flags the cycle.)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { createMetadataProtocolPlugin, ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQLPlugin } from './plugin';

describe('ADR-0076 Step 2 — delegated protocol assembly', () => {
  let kernel: ObjectKernel;

  beforeEach(() => {
    // See plugin.integration.test.ts for both choices: `logger.level` is the
    // real config key (`logLevel` never existed on ObjectKernelConfig and
    // silenced nothing), and gracefulShutdown:false keeps process signal
    // handlers out of vitest's fork workers (#4250).
    kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  });

  afterEach(async () => {
    if (kernel.getState() === 'running') await kernel.shutdown();
  });

  it('registerProtocol:false + MetadataProtocolPlugin reproduces the built-in service surface', async () => {
    await kernel.use(new ObjectQLPlugin({ registerProtocol: false }));
    await kernel.use(createMetadataProtocolPlugin());
    await kernel.bootstrap();

    const protocol = kernel.getService('protocol');
    expect(protocol).toBeInstanceOf(ObjectStackProtocolImplementation);
    // Hydration compatibility: the engine plugin's start() consumes this via
    // getService('protocol') + the loadMetaFromDb type guard.
    expect(typeof (protocol as any).loadMetaFromDb).toBe('function');

    // The degraded analytics fallback was retired (#3891): it dropped the
    // caller's ExecutionContext (unscoped aggregates) and ignored the contract
    // `where` filter. The slot stays EMPTY until service-analytics fills it —
    // /analytics 404s honestly instead of answering with wrong numbers.
    expect(() => kernel.getService('analytics')).toThrow();
  });

  it('registerProtocol:false WITHOUT the plugin boots protocol-free (consumers degrade)', async () => {
    await kernel.use(new ObjectQLPlugin({ registerProtocol: false }));
    await kernel.bootstrap();

    expect(() => kernel.getService('protocol')).toThrow();
    expect(() => kernel.getService('analytics')).toThrow();
    // The engine itself is fully alive.
    expect(kernel.getService('objectql')).toBeDefined();
  });

  it('built-in assembly + MetadataProtocolPlugin fails with the actionable configuration message', async () => {
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(createMetadataProtocolPlugin());
    await expect(kernel.bootstrap()).rejects.toThrow(/registerProtocol: false/);
  });

  it('default assembly registers protocol but leaves the analytics slot empty (#3891)', async () => {
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    expect(kernel.getService('protocol')).toBeInstanceOf(ObjectStackProtocolImplementation);
    expect(() => kernel.getService('analytics')).toThrow();
  });
});

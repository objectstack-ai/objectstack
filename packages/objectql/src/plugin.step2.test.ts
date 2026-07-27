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

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { SERVICE_SELF_INFO_KEY } from '@objectstack/spec/api';
import { createMetadataProtocolPlugin, ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQLPlugin } from './plugin';

describe('ADR-0076 Step 2 — delegated protocol assembly', () => {
  let kernel: ObjectKernel;

  beforeEach(() => {
    kernel = new ObjectKernel({ logLevel: 'silent' });
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

    // The lightweight analytics fallback rides with the protocol assembly and
    // keeps its D12 honest-capabilities self-descriptor.
    const analytics: any = kernel.getService('analytics');
    expect(analytics).toBeDefined();
    expect(analytics[SERVICE_SELF_INFO_KEY]?.status).toBe('degraded');
    expect(typeof analytics.query).toBe('function');
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

  it('default assembly is unchanged (backward compatibility)', async () => {
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    expect(kernel.getService('protocol')).toBeInstanceOf(ObjectStackProtocolImplementation);
    expect((kernel.getService('analytics') as any)[SERVICE_SELF_INFO_KEY]?.status).toBe('degraded');
  });
});

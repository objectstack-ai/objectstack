// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `MetadataManager.getPublished` serves a body that can carry this layer's own
// bookkeeping (`packageId`, `state`, the publish keys) beside the authored
// document. The type's read-path redactor judges the authored document alone:
// a key the type does not declare is withheld, the bookkeeping is served
// unchanged. Measured with the built-in `connector` redactor, which withholds
// every key a connector does not declare.
//
// Every value below is an obviously-fake placeholder.

import { describe, it, expect, vi } from 'vitest';
import { MetadataManager } from './metadata-manager.js';
import { MemoryLoader } from './loaders/memory-loader.js';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';

vi.mock('@objectstack/core', async (orig) => ({
  ...((await orig()) as object),
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const SECRET = 'TEST_PLACEHOLDER_PUBLISHED_UNDECLARED';
const authored = { label: 'Vendor', type: 'api', retryConfig: { maxAttempts: 2, secret: SECRET } };

function manager(): MetadataManager {
  const m = new MetadataManager({ formats: ['json'], loaders: [new MemoryLoader()] });
  m.setTypeRegistry(DEFAULT_METADATA_TYPE_REGISTRY);
  return m;
}

describe('getPublished: the redactor judges the authored body, the bookkeeping is served as stored', () => {
  it('a never-published row (the row itself is served): undeclared key withheld, packageId and state kept', async () => {
    const m = manager();
    await m.register('connector', 'vendor', { name: 'vendor', ...authored, apiKey: SECRET, packageId: 'com.acme.x', state: 'draft' });
    const served = (await m.getPublished('connector', 'vendor')) as Record<string, unknown>;
    expect(JSON.stringify(served)).not.toContain(SECRET);
    expect(served).toEqual({ name: 'vendor', label: 'Vendor', type: 'api', retryConfig: { maxAttempts: 2 }, packageId: 'com.acme.x', state: 'draft' });
  });

  it('a published snapshot that copied the row whole: the same answer', async () => {
    const m = manager();
    await m.register('connector', 'vendor', { name: 'vendor', ...authored, packageId: 'com.acme.x', state: 'draft' });
    await m.publishPackage('com.acme.x', { publishedBy: 'admin' });
    const served = (await m.getPublished('connector', 'vendor')) as Record<string, unknown>;
    expect(JSON.stringify(served)).not.toContain(SECRET);
    expect(served.packageId).toBe('com.acme.x');
    expect(served).toHaveProperty('state');
    expect(served.retryConfig).toEqual({ maxAttempts: 2 });
  });

  it('control: a body with nothing to withhold is served by reference-equal content, bookkeeping included', async () => {
    const m = manager();
    const row = { name: 'clean', label: 'Clean', type: 'api', packageId: 'com.acme.x', state: 'draft' };
    await m.register('connector', 'clean', row);
    expect(await m.getPublished('connector', 'clean')).toEqual(row);
  });
});

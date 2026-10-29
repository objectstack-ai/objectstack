// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package entry carries no `default` export (ADR-0087
 * `runtime-export-retired @objectstack/driver-memory#default`).
 *
 * The retired object was the legacy `{ id, version, onEnable }` shape, which is
 * not a kernel `Plugin`, and the CJS build could only reach it as
 * `require(...).default` while the published declarations said `export default`
 * (attw `FalseExportDefault`). The named exports are the supported surface.
 *
 * Pinned both ways: the entry has no `default`, and the named door the
 * changeset points readers to still constructs a working driver.
 */

import { describe, it, expect } from 'vitest';
import * as entry from './index.js';

describe('driver-memory entry: the legacy default export is retired', () => {
  it('the published entry has no default export', () => {
    expect('default' in entry).toBe(false);
  });

  it('the named exports stay, and InMemoryDriver still constructs a driver', () => {
    for (const name of ['InMemoryDriver', 'InMemoryStrategy', 'MemoryAnalyticsService', 'FileSystemPersistenceAdapter', 'LocalStoragePersistenceAdapter']) {
      expect(typeof (entry as Record<string, unknown>)[name]).toBe('function');
    }
    const driver = new entry.InMemoryDriver();
    expect(driver.name).toBe('com.objectstack.driver.memory');
  });
});

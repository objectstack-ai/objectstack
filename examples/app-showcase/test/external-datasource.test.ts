// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Smoke test for the external-datasource federation example (ADR-0015).
 * Asserts the datasource + federated objects are declared correctly — the
 * remote-table remap (`object.name !== external.remoteName`) is the whole point.
 * The live read path is covered by the driver-level integration test
 * (packages/drivers/driver-sql/src/sql-driver-external-remote-name.test.ts).
 */

import { describe, it, expect } from 'vitest';
import { ShowcaseExternalDatasource } from '../src/system/datasources/showcase-external.datasource.js';
import { ExternalCustomer, ExternalOrder } from '../src/data/objects/external/index.js';

describe('showcase external datasource (ADR-0015 federation)', () => {
  it('is an external, read-only datasource that degrades gracefully', () => {
    expect(ShowcaseExternalDatasource.name).toBe('showcase_external');
    expect(ShowcaseExternalDatasource.schemaMode).toBe('external');
    expect(ShowcaseExternalDatasource.external?.allowWrites).toBe(false);
    // A fixture hiccup must not brick the whole showcase boot.
    expect(ShowcaseExternalDatasource.external?.validation?.onMismatch).toBe('warn');
  });

  it('federated objects bind to remote tables via remoteName (name != table)', () => {
    expect(ExternalCustomer.datasource).toBe('showcase_external');
    expect(ExternalCustomer.external?.remoteName).toBe('customers');
    expect(ExternalCustomer.name).not.toBe(ExternalCustomer.external?.remoteName);

    expect(ExternalOrder.datasource).toBe('showcase_external');
    expect(ExternalOrder.external?.remoteName).toBe('orders');
    expect(ExternalOrder.name).not.toBe(ExternalOrder.external?.remoteName);
  });
});

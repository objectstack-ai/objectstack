// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * driver-odata through the plugin-driver conformance kit
 * (`definePluginDriverConformanceSuite`, `@objectstack/objectql`): the same kit
 * an out-of-repo plugin driver runs in its own CI, run here by the first
 * in-repo plugin driver, so a kit change that a real driver cannot pass fails
 * in this repository first.
 *
 * Each fixture is served by the in-process OData v4 service
 * (`__fixtures__/odata-service.ts`), which evaluates the `$filter` the driver
 * writes, over both collations. The floor tier only: the driver pushes down a
 * superset when a `where` does not translate whole, which the floor needs and
 * the direct tier (a driver that skips the floor) refuses by design.
 */

import { afterAll, describe, it } from 'vitest';
import {
  definePluginDriverConformanceSuite,
  type PluginDriverConformanceFixture,
  type PluginDriverConformanceTarget,
} from '@objectstack/objectql';
import { parseODataDriverConfig } from './config.js';
import { ODataDriver } from './odata-driver.js';
import type { FetchLike } from './transport.js';
import { CONFORMANCE_ROOT, odataService, type EdmType, type ServiceProperty } from './__fixtures__/odata-service.js';

const ENTITY_SET = 'Rows';
const EDM: Record<PluginDriverConformanceFixture['fields'][string]['type'], EdmType> = {
  text: 'Edm.String',
  number: 'Edm.Double',
  datetime: 'Edm.DateTimeOffset',
  date: 'Edm.Date',
};

/** The driver over `fetch`, bound to the fixture's object as an external object on the service's one entity set. */
function driverOver(fixture: PluginDriverConformanceFixture, fetch: FetchLike): PluginDriverConformanceTarget {
  const driver = new ODataDriver(parseODataDriverConfig({ name: 'conformance', serviceRoot: CONFORMANCE_ROOT }), { fetch });
  driver.registerExternalObject({ name: fixture.object, external: { remoteName: ENTITY_SET } });
  return { driver };
}

for (const collation of ['ordinal', 'case-insensitive'] as const) {
  definePluginDriverConformanceSuite(
    { describe, it, afterAll },
    {
      setup: (fixture) => {
        const properties: ServiceProperty[] = [
          { name: 'id', type: 'Edm.String', nullable: false },
          ...Object.entries(fixture.fields).map(([name, f]) => ({ name, type: EDM[f.type] })),
        ];
        const service = odataService({ entitySet: ENTITY_SET, properties, rows: fixture.rows, collation, serverPageSize: 5 });
        return driverOver(fixture, service.fetch);
      },
      setupUnavailable: (fixture) => driverOver(fixture, async () => { throw new TypeError('fetch failed: connect ECONNREFUSED'); }),
      writeProbes: [
        // The service answers 409 to a second entity under an existing key.
        { name: 'a create under a key the service already holds', operation: 'create', args: [{ id: '1', a: 'x' }], expect: 'refused' },
        { name: 'an update by key the service accepts', operation: 'update', args: ['1', { a: 'changed' }], expect: 'accepted' },
      ],
    },
    `driver-odata through the plugin-driver conformance kit, over a ${collation} service`,
  );
}

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `memory-persistence-auto-save-interval-to-ms` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `memoryPersistenceAutoSaveIntervalToMs` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapDatasources, renameKey } from '../../walk.js';
import { resolveDriverId } from '../../../data/driver/config-registry.zod.js';
import { isDict } from '../shared.js';

/**
 * `datasources[].config.persistence.autoSaveInterval` → `autoSaveIntervalMs`
 * for the memory driver (protocol 18, #15680 for #14478).
 *
 * BOTH arms of the persistence union move, and that is the load-bearing detail.
 * The gate listed only the `file` arm, because the `auto` arm's describe named
 * no unit at all and the predicate judges prose against name. But `auto`
 * resolves to the same Node.js file adapter and forwards the same value to the
 * same `FileSystemPersistenceAdapter` field, in the same milliseconds, under the
 * same `min(100)` bound — so converting one arm and not the other would leave
 * ONE value with TWO spellings across sibling arms of one union, and the driver
 * reading both. That is the consumer-side dialect Prime Directive #12 forbids.
 *
 * Driver-awareness is load-bearing here for the reason the retired
 * `datasource-config-driver-key-aliases` stated: `persistence` is a memory
 * driver key, and a `persistence` block under some other driver is not this
 * shape. `resolveDriverId` keeps the rewrite where it belongs.
 *
 * A string `persistence` (`'file'` / `'local'` / `'auto'`) and a custom-adapter
 * block carry no interval and pass through untouched.
 */
const memoryPersistenceAutoSaveIntervalToMs: MetadataConversion = {
  id: 'memory-persistence-auto-save-interval-to-ms',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.3.0',
  surface: 'datasource.config.persistence.autoSaveInterval',
  summary: "memory datasource key 'config.persistence.autoSaveInterval' → 'autoSaveIntervalMs', on both the file and auto arms (a duration key carries its unit in its name, and this one's unit lived only in the description; the value, milliseconds, is unchanged)",
  apply(stack, emit) {
    return mapDatasources(stack, (ds, path) => {
      if (resolveDriverId(ds.driver) !== 'memory') return ds;
      const config = ds.config;
      if (!isDict(config)) return ds;
      const persistence = config.persistence;
      if (!isDict(persistence)) return ds;
      const renamed = renameKey(persistence, 'autoSaveInterval', 'autoSaveIntervalMs');
      if (!renamed) return ds;
      emit({
        from: 'autoSaveInterval',
        to: 'autoSaveIntervalMs',
        path: `${path}.config.persistence.autoSaveIntervalMs`,
      });
      return { ...ds, config: { ...config, persistence: renamed } };
    });
  },
  fixture: {
    before: {
      datasources: [
        {
          name: 'local_cache',
          driver: 'memory',
          config: { persistence: { type: 'file', path: '/var/data/db.json', autoSaveInterval: 5000 } },
        },
        {
          name: 'auto_cache',
          driver: 'memory',
          config: { persistence: { type: 'auto', autoSaveInterval: 5000 } },
        },
        // A memory datasource with string persistence carries no interval.
        { name: 'scratch', driver: 'memory', config: { persistence: 'file' } },
        // Another driver's config is not this shape and is never touched.
        { name: 'primary', driver: 'postgres', config: { url: 'postgres://db/app' } },
      ],
    },
    after: {
      datasources: [
        {
          name: 'local_cache',
          driver: 'memory',
          config: { persistence: { type: 'file', path: '/var/data/db.json', autoSaveIntervalMs: 5000 } },
        },
        {
          name: 'auto_cache',
          driver: 'memory',
          config: { persistence: { type: 'auto', autoSaveIntervalMs: 5000 } },
        },
        { name: 'scratch', driver: 'memory', config: { persistence: 'file' } },
        { name: 'primary', driver: 'postgres', config: { url: 'postgres://db/app' } },
      ],
    },
    expectedNotices: 2,
  },
};

export { memoryPersistenceAutoSaveIntervalToMs };

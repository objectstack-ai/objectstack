// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `turso-config-timeout-to-timeout-ms` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `tursoConfigTimeoutToTimeoutMs` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapDatasources, renameConfigKey } from '../../walk.js';
import { resolveDriverId } from '../../../data/driver/config-registry.zod.js';

/**
 * `datasources[].config.timeout` → `timeoutMs` for the turso driver (protocol
 * 18, #15680 for #14478).
 *
 * Driver-awareness is load-bearing exactly as it was for the retired
 * `datasource-config-driver-key-aliases`: a bare `config.timeout` under some
 * OTHER driver is that driver's own key and must not be touched, so the rewrite
 * is gated on `resolveDriverId(ds.driver) === 'turso'` (which also catches a
 * stored `driver: 'libsql'` through the alias table).
 *
 * The neighbour is why this key was worth the rename: `sync.intervalSeconds`,
 * two keys above, already spelled ITS unit. One shape, both conventions.
 *
 * ⚠️ This converts the SPEC's turso contract. `@objectstack/driver-turso` ships
 * its own parallel `turso.zod.ts` declaring the same authored key, which was
 * outside this gate's declared population when this entry was written. #15682
 * widened that population to every workspace package's zod schemas and renamed
 * the mirror in the same PR, so both declarations now spell `timeoutMs` and
 * this ONE conversion covers the authored surface for both. The mirror
 * registers no second entry: it would restate the same rewrite in
 * `spec-changes.json` and the upgrade guide without converting anything the
 * rename above has not already converted.
 */
const tursoConfigTimeoutToTimeoutMs: MetadataConversion = {
  id: 'turso-config-timeout-to-timeout-ms',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.3.0',
  surface: 'datasource.config.timeout (turso)',
  summary: "turso datasource key 'config.timeout' → 'config.timeoutMs' (a duration key carries its unit in its name, and this one's unit lived only in the description and a .meta() title no parse reads; the value, milliseconds, is unchanged)",
  apply(stack, emit) {
    return mapDatasources(stack, (ds, path) => {
      if (resolveDriverId(ds.driver) !== 'turso') return ds;
      const renamed = renameConfigKey(ds, 'timeout', 'timeoutMs');
      if (!renamed) return ds;
      emit({ from: 'timeout', to: 'timeoutMs', path: `${path}.config.timeoutMs` });
      return renamed;
    });
  },
  fixture: {
    before: {
      datasources: [
        {
          name: 'edge_db',
          driver: 'turso',
          config: { url: 'libsql://app.turso.io', timeout: 30000 },
        },
        // A turso datasource that never authored the key keeps its identity.
        { name: 'edge_replica', driver: 'turso', config: { url: 'libsql://replica.turso.io' } },
        // `timeout` under another driver is that driver's own key — untouched.
        { name: 'legacy', driver: 'mysql', config: { url: 'mysql://db/app', timeout: 1000 } },
      ],
    },
    after: {
      datasources: [
        {
          name: 'edge_db',
          driver: 'turso',
          config: { url: 'libsql://app.turso.io', timeoutMs: 30000 },
        },
        { name: 'edge_replica', driver: 'turso', config: { url: 'libsql://replica.turso.io' } },
        { name: 'legacy', driver: 'mysql', config: { url: 'mysql://db/app', timeout: 1000 } },
      ],
    },
    expectedNotices: 1,
  },
};

export { tursoConfigTimeoutToTimeoutMs };

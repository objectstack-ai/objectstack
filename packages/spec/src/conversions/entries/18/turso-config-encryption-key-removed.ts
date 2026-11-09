// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `turso-config-encryption-key-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there (the helper
// `TURSO_REMOTE_URL_PREFIXES` is read by this conversion alone). A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `tursoConfigEncryptionKeyRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapDatasources } from '../../walk.js';
import { resolveDriverId } from '../../../data/driver/config-registry.zod.js';

/**
 * The remote-url prefixes the turso driver classifies as remote, matched in
 * any letter case — the list `TURSO_REMOTE_URL_PREFIXES` in
 * `data/driver/turso.zod.ts` carries (module-local there, and not worth a
 * public export for one conversion).
 */
const TURSO_REMOTE_URL_PREFIXES = ['libsql://', 'https://', 'http://', 'wss://', 'ws://'] as const;

/**
 * `datasources[].config.encryptionKey` leaves the turso contract (protocol 18,
 * #25050 — ADR-0049 enforce-or-remove).
 *
 * The key promised an AES-256 key for the local database file and was
 * honoured in no mode: the driver reads and writes a local or replica file
 * through better-sqlite3, which has no encryption codec, and it never handed
 * the key to the libSQL client it builds for a remote url. #25020 refused it
 * beside a `file:` url or `:memory:`; #25050 tombstones it (`retiredKey()` on
 * `TursoConfigSchema`), so a live author is refused at parse in every mode.
 *
 * **Partial on purpose: it strips only where stripping changes nothing.**
 *
 *  - an UNSET value — an empty string, or any non-string a parse never
 *    accepted — which every loader already dropped;
 *  - a non-empty key beside a REMOTE url (`libsql://`, `https://`, `http://`,
 *    `ws(s)://`, any letter case, trimmed as the loaders trim it), which the
 *    driver parsed and dropped: removing it leaves the connection exactly as
 *    it was.
 *
 * A non-empty key beside a local url (`file:` or `:memory:`, in any mode) is
 * LEFT for the author, as #25020 left it: that datasource's operator believed
 * the file encrypted, and whether to accept a plaintext file, move it to an
 * encrypted volume or move the data to a remote database is intent no
 * artifact records — the D3 entry `turso-config-encryption-key-retired`
 * carries it. Stripping it here would turn #25020's loud refusal at driver
 * construction back into silence for exactly the rows it exists to surface.
 *
 * Driver-aware exactly like {@link tursoConfigTimeoutToTimeoutMs}: an
 * `encryptionKey` under another driver is not this contract's key and is never
 * touched; `resolveDriverId` also catches a stored `driver: 'libsql'`.
 * `@objectstack/driver-turso`'s mirror tombstones the same key and registers
 * no second entry (the precedent the timeout rename set).
 *
 * Retired from the load path: stored rows (`loadDatasourceRows` /
 * `loadDatasourceRow` replay the full chain), built artifacts and
 * `os migrate meta --from 17` replay it. Idempotent: a stripped config has no
 * key left to strip.
 */
const tursoConfigEncryptionKeyRemoved: MetadataConversion = {
  id: 'turso-config-encryption-key-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '18.0.0',
  surface: 'datasource.config.encryptionKey (turso)',
  summary:
    "turso datasource key 'config.encryptionKey' removed where it changed nothing — an unset value, or a "
    + 'key beside a remote url, which the driver never handed to the libSQL client (ADR-0049 '
    + 'enforce-or-remove: the key was honoured in no mode); a non-empty key beside a local file: url or '
    + ':memory: is left for the author, since that operator believed the file encrypted',
  apply(stack, emit) {
    return mapDatasources(stack, (ds, path) => {
      if (resolveDriverId(ds.driver) !== 'turso') return ds;
      const config = ds.config;
      if (!config || typeof config !== 'object' || Array.isArray(config)) return ds;
      const cfg = config as Record<string, unknown>;
      if (!('encryptionKey' in cfg)) return ds;
      const key = cfg.encryptionKey;
      const unset = typeof key !== 'string' || key === '';
      const url = typeof cfg.url === 'string' ? cfg.url.trim() : '';
      const remote = TURSO_REMOTE_URL_PREFIXES.some(
        (prefix) => url.slice(0, prefix.length).toLowerCase() === prefix,
      );
      if (!unset && !remote) return ds;
      const { encryptionKey: _removed, ...rest } = cfg;
      emit({ from: 'encryptionKey', to: '(removed)', path: `${path}.config.encryptionKey` });
      return { ...ds, config: rest };
    });
  },
  fixture: {
    before: {
      datasources: [
        // A remote url: the driver dropped the key, so it goes.
        { name: 'edge_db', driver: 'turso', config: { url: 'libsql://app.turso.io', encryptionKey: 'k1' } },
        // An uppercase https url behind whitespace: the same.
        { name: 'edge_https', driver: 'turso', config: { url: ' HTTPS://app.turso.io', encryptionKey: 'k2' } },
        // An unset key beside a local file: every loader dropped it, so it goes.
        { name: 'edge_local_unset', driver: 'turso', config: { url: 'file:./data/app.db', encryptionKey: '' } },
        // A non-empty key beside a local file: left for the author.
        { name: 'edge_local', driver: 'turso', config: { url: 'file:./data/app.db', encryptionKey: 'k3' } },
        // Another driver's key of the same name: not this contract's — untouched.
        { name: 'legacy', driver: 'mysql', config: { url: 'mysql://db/app', encryptionKey: 'k4' } },
        // A turso datasource that never authored the key keeps its identity.
        { name: 'edge_replica', driver: 'turso', config: { url: 'libsql://replica.turso.io' } },
      ],
    },
    after: {
      datasources: [
        { name: 'edge_db', driver: 'turso', config: { url: 'libsql://app.turso.io' } },
        { name: 'edge_https', driver: 'turso', config: { url: ' HTTPS://app.turso.io' } },
        { name: 'edge_local_unset', driver: 'turso', config: { url: 'file:./data/app.db' } },
        { name: 'edge_local', driver: 'turso', config: { url: 'file:./data/app.db', encryptionKey: 'k3' } },
        { name: 'legacy', driver: 'mysql', config: { url: 'mysql://db/app', encryptionKey: 'k4' } },
        { name: 'edge_replica', driver: 'turso', config: { url: 'libsql://replica.turso.io' } },
      ],
    },
    expectedNotices: 3,
  },
};

export { tursoConfigEncryptionKeyRemoved };

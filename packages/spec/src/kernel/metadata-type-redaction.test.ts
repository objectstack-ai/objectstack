// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8300 — the per-type metadata read-path redaction seam.
 *
 * The blocks below hold, in order: the register/lookup round trip (the seam's
 * contract, mirroring `registerMetadataTypeSchema`); the FAIL-CLOSED wiring of
 * the built-in `datasource` redactor (#8300's central measurement: plugin-init
 * registration is fail-open because the admin plugin is opt-in while
 * `sys_metadata` rows and the `/meta` read exits exist without it — so the
 * built-in must be present with ZERO registration calls); and the
 * absence-vs-empty distinction #8154's consumer depends on (no redactor
 * registered ⇒ `undefined`; redactor ran with nothing to hide ⇒
 * `redactedKeys: []` — collapsing the two would make "looks protected" and
 * "is protected" indistinguishable again).
 */

import { describe, expect, it } from 'vitest';

import {
  getMetadataTypeRedactor,
  listMetadataTypeRedactorTypes,
  registerMetadataTypeRedactor,
  type MetadataRedactionResult,
  type MetadataTypeRedactor,
} from './metadata-type-redaction';

describe('register/lookup round trip (the registry pattern of registerMetadataTypeSchema)', () => {
  it('a registered redactor is returned for its type', () => {
    const redactor: MetadataTypeRedactor = (item) => ({
      item: { ...item, clientSecret: undefined },
      redactedKeys: ['clientSecret'],
    });
    registerMetadataTypeRedactor('sso_provider_test', redactor);
    expect(getMetadataTypeRedactor('sso_provider_test')).toBe(redactor);
    expect(listMetadataTypeRedactorTypes()).toContain('sso_provider_test');
  });

  it('re-registration replaces (idempotent registry, same as the schema seam)', () => {
    const first: MetadataTypeRedactor = (item) => ({ item, redactedKeys: [] });
    const second: MetadataTypeRedactor = (item) => ({ item, redactedKeys: [] });
    registerMetadataTypeRedactor('replace_me_test', first);
    registerMetadataTypeRedactor('replace_me_test', second);
    expect(getMetadataTypeRedactor('replace_me_test')).toBe(second);
    // One entry, not two.
    expect(listMetadataTypeRedactorTypes().filter((t) => t === 'replace_me_test')).toHaveLength(1);
  });

  it('a registered redactor overrides a built-in, exactly as registered schemas do', () => {
    const builtin = getMetadataTypeRedactor('datasource');
    expect(builtin).toBeDefined();
    const override: MetadataTypeRedactor = (item) => ({ item, redactedKeys: [] });
    registerMetadataTypeRedactor('datasource', override);
    try {
      expect(getMetadataTypeRedactor('datasource')).toBe(override);
    } finally {
      // Restore the built-in for the rest of the suite — the registry is
      // module-level state shared across tests.
      registerMetadataTypeRedactor('datasource', builtin!);
    }
  });
});

describe('FAIL-CLOSED: the datasource redactor is a BUILT-IN, not a plugin registration', () => {
  it('is resolvable with zero registration calls — no opt-in plugin in sight', () => {
    // The #8300 measurement this pins: registering from
    // `DatasourceAdminServicePlugin.init` is fail-open (the plugin is opt-in;
    // the rows and read exits exist without it). If this lookup ever starts
    // answering `undefined` on a fresh module load, cleartext would serve
    // while looking protected — the worst available outcome.
    const redactor = getMetadataTypeRedactor('datasource');
    expect(redactor).toBeDefined();
    expect(listMetadataTypeRedactorTypes()).toContain('datasource');
  });

  it('redacts a legacy stored row through the ONE credential-key definition', () => {
    const stored = {
      name: 'legacy_pg',
      driver: 'postgres',
      config: {
        host: 'db.internal',
        database: 'app',
        username: 'admin',
        password: 'hunter2',
        url: 'postgresql://admin:hunter2@db.internal:5432/app',
      },
      _diagnostics: { valid: false, issues: [{ path: ['config', 'password'] }] },
    };
    const result = getMetadataTypeRedactor('datasource')!(stored) as MetadataRedactionResult;

    expect(result.item.config).toEqual({
      host: 'db.internal',
      database: 'app',
      username: 'admin',
      url: 'postgresql://admin@db.internal:5432/app',
    });
    expect(JSON.stringify(result.item)).not.toContain('hunter2');
    expect(result.redactedKeys).toEqual(['config.password', 'config.url']);
    // `_diagnostics` is load-bearing (#8154: the valid:false badge is the
    // migration inventory) — the redactor must pass it through untouched.
    expect(result.item._diagnostics).toBe(stored._diagnostics);
    // Pure: the STORED body keeps its credential; the connect path reads it.
    expect(stored.config.password).toBe('hunter2');
    expect(stored.config.url).toBe('postgresql://admin:hunter2@db.internal:5432/app');
  });

  it('turso: alias spellings and the still-writable encryptionKey are covered end-to-end', () => {
    const result = getMetadataTypeRedactor('datasource')!({
      name: 't',
      driver: 'turso',
      config: { url: 'libsql://db.turso.io', authToken: 'jwt-token', encryptionKey: 'aes', passwd: 'x' },
    });
    expect(result.item.config).toEqual({ url: 'libsql://db.turso.io' });
    expect(result.redactedKeys).toEqual(['config.authToken', 'config.encryptionKey', 'config.passwd']);
  });

  it('an item with no config object is passed through as-is', () => {
    const noConfig = { name: 'x', driver: 'postgres' };
    expect(getMetadataTypeRedactor('datasource')!(noConfig)).toEqual({
      item: noConfig,
      redactedKeys: [],
    });
    const arrayConfig = { name: 'x', driver: 'postgres', config: ['not', 'an', 'object'] };
    expect(getMetadataTypeRedactor('datasource')!(arrayConfig).item).toBe(arrayConfig);
  });
});

describe('absence is distinguishable from "nothing to redact" (#8154 consumer contract)', () => {
  it('a type with no redactor answers undefined — a fact, not a failure', () => {
    expect(getMetadataTypeRedactor('object')).toBeUndefined();
    expect(getMetadataTypeRedactor('view')).toBeUndefined();
    expect(getMetadataTypeRedactor('type-that-does-not-exist')).toBeUndefined();
  });

  it('a redactor that finds nothing answers [] with the item served intact', () => {
    const clean = { name: 'clean', driver: 'postgres', config: { host: 'h', database: 'd' } };
    const result = getMetadataTypeRedactor('datasource')!(clean);
    expect(result.redactedKeys).toEqual([]);
    expect(result.item).toEqual(clean);
  });
});

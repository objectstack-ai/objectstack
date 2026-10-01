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
  isStoredMetadataBodyObject,
  listMetadataTypeRedactorTypes,
  redactStoredMetadataBody,
  redactStoredMetadataRow,
  redactStoredMetadataRows,
  registerMetadataTypeRedactor,
  STORED_METADATA_BODY_OBJECTS,
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

  it('a NESTED credential position OFF the passthrough table is withheld at this door too (the class control)', () => {
    // The nested-position finding, measured at THIS consumer: a credential
    // spelling one object level down (`options.auth.token` — deliberately not
    // a `passthroughSecretPaths` row) used to flow through this hook verbatim
    // with `redactedKeys: []`, so `/meta/datasource` — a door any
    // authenticated caller reaches — served it cleartext.
    const stored = {
      name: 'events',
      driver: 'mongodb',
      config: {
        database: 'app',
        options: { auth: { username: 'svc', token: 'eyJhbGci.SECRET.y' }, replicaSet: 'rs0' },
      },
    };
    const result = getMetadataTypeRedactor('datasource')!(stored) as MetadataRedactionResult;
    expect(JSON.stringify(result.item)).not.toContain('SECRET');
    expect(result.item.config).toEqual({
      database: 'app',
      options: { auth: { username: 'svc' }, replicaSet: 'rs0' },
    });
    // Dotted, item-relative — the shape the generic write-door carry-forward
    // (`carryForwardRedactedValues`) walks, nested paths included.
    expect(result.redactedKeys).toEqual(['config.options.auth.token']);
    // Pure: the stored body keeps its material for the connect path.
    expect((stored.config.options.auth as Record<string, unknown>).token).toBe('eyJhbGci.SECRET.y');
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

describe('stored metadata ROWS — the family-wide seam (#21120)', () => {
  // A datasource body as it is stored in sys_metadata.metadata: serialized JSON
  // carrying credential material the datasource redactor withholds.
  const storedDatasourceBody = () =>
    JSON.stringify({
      name: 'ds',
      driver: 'turso',
      config: { url: 'libsql://db.turso.io', encryptionKey: 'aes-stored-key' },
    });

  it('isStoredMetadataBodyObject names exactly the two body tables', () => {
    expect(isStoredMetadataBodyObject('sys_metadata')).toBe(true);
    expect(isStoredMetadataBodyObject('sys_metadata_history')).toBe(true);
    expect(isStoredMetadataBodyObject('sys_audit_log')).toBe(false);
    expect(isStoredMetadataBodyObject('showcase_task')).toBe(false);
    expect([...STORED_METADATA_BODY_OBJECTS].sort()).toEqual(['sys_metadata', 'sys_metadata_history']);
  });

  it('redactStoredMetadataRow withholds credential material from a datasource body row (string column)', () => {
    const row = { id: '1', name: 'ds', type: 'datasource', metadata: storedDatasourceBody() };
    const served = redactStoredMetadataRow('sys_metadata', row);
    expect(JSON.stringify(served)).not.toContain('aes-stored-key');
    // Non-body columns are untouched.
    expect(served.id).toBe('1');
    expect(served.type).toBe('datasource');
    // The served body still parses and keeps its non-credential material.
    const body = JSON.parse(served.metadata as string) as { config: Record<string, unknown> };
    expect(body.config.url).toBe('libsql://db.turso.io');
    expect(body.config.encryptionKey).toBeUndefined();
    // Pure: the stored row's bytes are unchanged (connect path still reads them).
    expect(row.metadata).toBe(storedDatasourceBody());
  });

  it('redactStoredMetadataRow serves a credential-free body as its stored bytes (by reference)', () => {
    const row = {
      id: '2',
      type: 'datasource',
      metadata: JSON.stringify({ name: 'ds2', driver: 'postgres', config: { host: 'h', database: 'd' } }),
    };
    expect(redactStoredMetadataRow('sys_metadata', row)).toBe(row);
  });

  it('a body of a type with NO redactor is served as stored (absence is a fact about the type)', () => {
    const row = { id: '3', type: 'view', metadata: JSON.stringify({ name: 'v', columns: ['a'] }) };
    expect(redactStoredMetadataRow('sys_metadata', row)).toBe(row);
  });

  it('FAIL-CLOSED: a redacted type whose body does not parse has the body column OMITTED', () => {
    const row = { id: '4', type: 'datasource', metadata: '{not valid json' };
    const served = redactStoredMetadataRow('sys_metadata', row) as Record<string, unknown>;
    expect('metadata' in served).toBe(false);
    expect(served.id).toBe('4');
    expect(served.type).toBe('datasource');
  });

  it('a row of an object OUTSIDE the set passes through untouched (safe to call unconditionally)', () => {
    const row = { id: '5', type: 'datasource', metadata: storedDatasourceBody() };
    expect(redactStoredMetadataRow('sys_webhook', row)).toBe(row);
    expect(redactStoredMetadataRow('showcase_task', row)).toBe(row);
  });

  it('a row with no body column, a null body, and a non-object row all pass through', () => {
    const noBody = { id: '6', type: 'datasource' };
    expect(redactStoredMetadataRow('sys_metadata', noBody)).toBe(noBody);
    const nullBody = { id: '7', type: 'datasource', metadata: null };
    expect(redactStoredMetadataRow('sys_metadata', nullBody)).toBe(nullBody);
    expect(redactStoredMetadataRow('sys_metadata', 'not-a-row' as unknown as Record<string, unknown>)).toBe(
      'not-a-row',
    );
  });

  it('redactStoredMetadataRows maps the row redactor and leaves a non-array input alone', () => {
    const rows = [
      { id: '8', type: 'datasource', metadata: storedDatasourceBody() },
      { id: '9', type: 'view', metadata: JSON.stringify({ name: 'v' }) },
    ];
    const served = redactStoredMetadataRows('sys_metadata', rows);
    expect(JSON.stringify(served)).not.toContain('aes-stored-key');
    expect(served[1]).toBe(rows[1]); // untouched (no redactor for 'view')
    expect(redactStoredMetadataRows('showcase_task', rows)).toBe(rows);
  });

  it('redactStoredMetadataBody fails closed on a redacted type that does not parse', () => {
    expect(redactStoredMetadataBody('datasource', '{broken')).toEqual({ ok: false });
    // A null / absent body is nothing to redact.
    expect(redactStoredMetadataBody('datasource', null)).toEqual({ ok: true, body: null });
    // A type with no redactor keeps its body even when unparseable.
    expect(redactStoredMetadataBody('view', '{broken')).toEqual({ ok: true, body: '{broken' });
  });
});

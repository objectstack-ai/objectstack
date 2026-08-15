// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The #8155 re-homing planner: which stored rows can have their cleartext
 * credential moved into `sys_secret`, and what every other row is told instead.
 *
 * The taxonomy is driven against the REAL driver contracts (`refusedCredentialKeys`
 * / `redactableConfigKeys` from `@objectstack/spec/data`), never a local list of
 * key names — a planner that agreed with a hand-copied fixture and disagreed
 * with the contracts would pass this file and re-home the wrong key in
 * production.
 *
 * Every refusal asserts BOTH halves: that the plan refuses, and that it names a
 * remedy. An unstated outcome for the residue is the gap that makes a migration
 * story incomplete, so "it refused" alone is not the assertion.
 */

import { describe, it, expect } from 'vitest';
import { BUILTIN_DRIVER_IDS, refusedCredentialKeys } from '@objectstack/spec/data';
import { planCredentialMigration, urlCredentialKeys } from '../datasource-credential-migration.js';
import type { StoredDatasource } from '../datasource-admin-service.js';

const row = (over: Partial<StoredDatasource> = {}): StoredDatasource => ({
  name: 'warehouse',
  driver: 'postgres',
  origin: 'runtime',
  config: { host: 'db.internal', port: 5432, database: 'app', username: 'app' },
  ...over,
});

describe('planCredentialMigration — the bindable slot', () => {
  it('binds the driver\'s own refused credential key, and only it', () => {
    const plan = planCredentialMigration(
      row({ config: { host: 'db.internal', username: 'app', password: 'hunter2' } }),
    );
    expect(plan).toEqual({ action: 'bind', key: 'password', value: 'hunter2', remaining: [] });
  });

  it('binds turso\'s slot, which is `authToken` rather than `password`', () => {
    // Not a hardcoded expectation: assert the planner picked whatever THIS
    // driver's contract declares refused, so a contract change moves both.
    const plan = planCredentialMigration(
      row({ driver: 'turso', config: { url: 'libsql://x.turso.io', authToken: 'jwt.value' } }),
    );
    expect(refusedCredentialKeys('turso')).toContain('authToken');
    expect(plan).toMatchObject({ action: 'bind', key: 'authToken', value: 'jwt.value' });
  });

  it('leaves a libSQL url alone — it is the target, not a credential channel', () => {
    // The url survives into the migrated config; only the token moves. This is
    // what makes the URL refusal below a statement about EMBEDDED credentials
    // rather than about urls.
    expect(urlCredentialKeys({ url: 'libsql://x.turso.io' })).toEqual([]);
  });

  it('treats an empty-string credential as unset, not as a credential of length zero', () => {
    const plan = planCredentialMigration(row({ config: { host: 'h', password: '' } }));
    expect(plan).toEqual({ action: 'none', status: 'nothing-to-migrate', remaining: [] });
  });
});

describe('planCredentialMigration — idempotency (no second sys_secret row)', () => {
  it('a migrated row is a no-op: already-bound, nothing to bind', () => {
    const plan = planCredentialMigration(
      row({ config: { host: 'h', username: 'app' }, external: { credentialsRef: 'sys_secret:abc' } }),
    );
    expect(plan).toEqual({ action: 'none', status: 'already-bound', remaining: [] });
  });

  it('a row with BOTH a ref and an inline copy drops the copy against the EXISTING ref', () => {
    // Reachable two ways, both real: an interrupted earlier run, and a wizard
    // re-entry (whose `restoreRedactedConfig` carries the stored cleartext
    // forward by design). Binding again is exactly the orphan accumulation
    // #8103 measured, so the plan must reuse the ref it found.
    const plan = planCredentialMigration(
      row({
        config: { host: 'h', username: 'app', password: 'hunter2' },
        external: { credentialsRef: 'sys_secret:abc' },
      }),
    );
    expect(plan).toEqual({
      action: 'drop-inline',
      key: 'password',
      credentialsRef: 'sys_secret:abc',
      remaining: [],
    });
    expect(plan).not.toMatchObject({ action: 'bind' });
  });
});

describe('planCredentialMigration — stated outcomes for what it will not touch', () => {
  const refusal = (r: StoredDatasource) => {
    const plan = planCredentialMigration(r);
    expect(plan.action).toBe('refuse');
    if (plan.action !== 'refuse') throw new Error('unreachable');
    expect(plan.reason.length).toBeGreaterThan(0);
    // The half fallback (a) exists for: a refused row must be told what to do.
    expect(plan.remedy.length).toBeGreaterThan(0);
    return plan;
  };

  it('refuses a credential embedded in a connection URL, naming the key', () => {
    const plan = refusal(row({ config: { url: 'postgresql://app:hunter2@db.internal:5432/app' } }));
    expect(plan.reason).toContain('config.url');
    expect(plan.remedy).toContain('secret field');
  });

  it('refuses a URL credential even when a discrete key could be bound', () => {
    // The row-level rule is deliberately whole-row: re-homing the discrete key
    // while leaving a URL credential at rest would report success over a
    // datasource that is still storing a password in cleartext.
    const plan = refusal(
      row({ config: { url: 'postgresql://app:hunter2@db/app', password: 'hunter2' } }),
    );
    expect(plan.reason).toContain('config.url');
  });

  it('refuses a code-defined datasource — its definition is owned by the artifact', () => {
    const plan = refusal(row({ origin: 'code', config: { host: 'h', password: 'p' } }));
    expect(plan.reason).toContain('code-defined');
  });

  it('refuses an artefact row with no `origin` at all (treated as code)', () => {
    const plan = refusal(row({ origin: undefined, config: { host: 'h', password: 'p' } }));
    expect(plan.reason).toContain('code-defined');
  });

  it('refuses a pre-#8078 alias spelling rather than binding a key no builder reads', () => {
    // `passwd` reaches no connection builder, so binding it would ADD
    // authentication to a connection that works without it today.
    const plan = refusal(row({ config: { host: 'h', passwd: 'hunter2' } }));
    expect(plan.reason).toContain('config.passwd');
  });

  it('refuses turso\'s `encryptionKey` — credential-shaped, but not the binder\'s slot', () => {
    const plan = refusal(
      row({ driver: 'turso', config: { url: 'libsql://x.turso.io', encryptionKey: 'aes-key' } }),
    );
    expect(plan.reason).toContain('config.encryptionKey');
    expect(refusedCredentialKeys('turso')).not.toContain('encryptionKey');
  });

  it('refuses a driver this platform ships no contract for — the slot is unknown', () => {
    const plan = refusal(
      row({ driver: 'acme-warehouse', config: { password: 'p', authToken: 't' } }),
    );
    expect(plan.reason).toContain('no config contract');
    expect(plan.reason).toContain('acme-warehouse');
  });

  it('refuses a credential-shaped key on a driver that takes no credential at all', () => {
    const plan = refusal(row({ driver: 'sqlite', config: { filename: './app.db', password: 'p' } }));
    expect(plan.reason).toContain('takes no bound credential');
  });

  it('says nothing-to-migrate for a driver with no credential slot at all', () => {
    const plan = planCredentialMigration(
      row({ driver: 'sqlite', config: { filename: './data/app.db' } }),
    );
    expect(plan).toEqual({ action: 'none', status: 'nothing-to-migrate', remaining: [] });
  });
});

describe('the one-slot invariant the planner is built on', () => {
  it('every builtin driver declares AT MOST ONE bindable credential key', () => {
    // The datasource secret binder fills exactly one slot per datasource, so
    // the planner's "which key do I move?" question has one answer only while
    // this holds. It is asserted rather than assumed because the planner's
    // multi-candidate refusal is unreachable through any shipped contract —
    // when this goes red, that arm starts firing and the real decision (which
    // credential the single slot should carry) lands on a human.
    const multi = BUILTIN_DRIVER_IDS
      .map((id) => [id, refusedCredentialKeys(id)] as const)
      .filter(([, keys]) => keys.length > 1);
    expect(multi, `drivers declaring >1 inline credential key: ${JSON.stringify(multi)}`).toEqual([]);
  });

  it('the drivers that DO declare a slot are the ones whose connect path reads the injected secret', () => {
    // Pins the table in this module's header against the real contracts: the
    // planner may only move a key the connect path substitutes `spec.secret`
    // for. postgres/mysql/mongodb take it as `password`; turso reads it ahead
    // of `config.authToken` (#8152); the file-backed drivers take none.
    const slots = Object.fromEntries(
      BUILTIN_DRIVER_IDS.map((id) => [id, refusedCredentialKeys(id).join(',')]),
    );
    expect(slots).toEqual({
      memory: '',
      sqlite: '',
      'sqlite-wasm': '',
      postgres: 'password',
      mysql: 'password',
      mongodb: 'password',
      turso: 'authToken',
    });
  });
});

describe('urlCredentialKeys', () => {
  it('finds a userinfo password in any string config value, not just `url`', () => {
    expect(urlCredentialKeys({ url: 'postgresql://u:p@h/db', syncUrl: 'libsql://x' }))
      .toEqual(['url']);
    expect(urlCredentialKeys({ syncUrl: 'postgresql://u:p@h/db' })).toEqual(['syncUrl']);
  });

  it('does not mistake a colon in a path or query for userinfo', () => {
    expect(urlCredentialKeys({ url: 'https://host/a:b@c' })).toEqual([]);
    expect(urlCredentialKeys({ url: 'postgresql://app@db/app' })).toEqual([]);
  });

  it('finds the #8337 query-parameter spelling too — a stored `?authToken=` row must not plan `nothing-to-migrate`', () => {
    expect(urlCredentialKeys({ url: 'libsql://x.turso.io?authToken=eyJhbGci.x.y' })).toEqual(['url']);
    expect(urlCredentialKeys({ syncUrl: 'libsql://x.turso.io?tls=1&authToken=x' })).toEqual(['syncUrl']);
    // A benign query parameter is not a credential.
    expect(urlCredentialKeys({ url: 'libsql://x.turso.io?tls=1' })).toEqual([]);
  });

  it('a query-token row is REFUSED with the per-row remedy, like its userinfo sibling', () => {
    const plan = planCredentialMigration(
      row({ driver: 'turso', config: { url: 'libsql://x.turso.io?authToken=eyJhbGci.x.y' } }),
    );
    expect(plan).toMatchObject({ action: 'refuse' });
    expect((plan as { remedy: string }).remedy).toContain('secret field');
  });
});

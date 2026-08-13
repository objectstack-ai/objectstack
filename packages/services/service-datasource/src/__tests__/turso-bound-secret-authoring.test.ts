// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8152 — a NEW turso datasource authored with a BOUND secret authenticates.
 *
 * ## The defect, and why nothing caught it
 *
 * #7990/#8078 closed the inline door: `config.authToken` is `z.never()` at every
 * authoring door, exactly like the SQL drivers' `config.password`. The route an
 * author is diverted TO — bind the credential, keep only
 * `external.credentialsRef` on the record — resolves the cleartext into
 * `spec.secret` at connect time. Nothing on the turso path read it. So after
 * #8078 a new turso remote datasource had no working credential route at all:
 * refused inline, dropped when bound.
 *
 * It stayed invisible because it broke nothing that already worked. A stored row
 * carrying inline `config.authToken` bypasses the parse and still connects, and
 * the host boot paths translate `OS_DATABASE_AUTH_TOKEN` / `TURSO_AUTH_TOKEN`
 * into a `config` they construct themselves, which never meets the authoring
 * schema. Only NEW authoring was dead.
 *
 * ## What each pin reads on `origin/main` (reverse verification)
 *
 * ⚠️ The vacuity trap this file is written around: any case that starts from an
 * ALREADY-EXISTING turso datasource is green on `main` too, because stored config
 * bypasses the parse. Every red pin below therefore starts at
 * `createDatasource()` — the authoring door — and carries its credential the only
 * way that door permits.
 *
 * RED on main (carries the defect this card fixes):
 *  - "a datasource created with a bound secret reaches the driver with an
 *    authToken" — on main the builder returned `{ url }` for the spec the connect
 *    path hands it, so the assertion on `authToken` failed. Measured on
 *    `origin/main`, not inferred.
 *  - "the bound secret is the ONLY credential a newly authored datasource can
 *    carry" — pins both halves at once: the door refuses the inline key AND the
 *    bound one arrives. On main the first half passed and the second failed,
 *    which is the dead end stated above.
 *  - "binds the secret to authToken alone, leaving the encryptionKey question
 *    open" — red on main via its `authToken` half. The `encryptionKey` half is
 *    forward-facing and is asserted BESIDE that one rather than alone, because
 *    alone it is green on main for the useless reason (main emitted neither key).
 *
 * GREEN on main (guards behaviour that must NOT change):
 *  - "#8078's refusal still fires at create and at update" — guards the spec half.
 *    This card restores the alternative route; it must not reopen the inline one.
 *    Passed on main and must keep passing.
 *  - "the refusal still names both mechanisms it diverts to" — the guidance is
 *    what makes the refusal actionable, and it now points at a route that
 *    actually works. Passed on main.
 *  - "postgres / mysql / mongodb still read `spec.secret` as the password" —
 *    guards the sibling arms this change takes its shape FROM. Untouched by the
 *    diff, unpinned before it. Passed on main and must keep passing.
 *
 * ## The one seam, stated rather than hidden
 *
 * The factory's real `turso` arm cannot run here: `@objectstack/driver-turso` is
 * deliberately not resolvable from this package (that is what "optional" means,
 * and the missing-package arm's own pin depends on it). So the red pins capture
 * the spec the connect path actually hands `factory.create()` — real authoring
 * door, real secret binder, real credential resolution — and run the real
 * `buildTursoDriverConfig` on exactly that spec, which is the line the factory
 * arm itself executes (`default-datasource-driver-factory.ts`, `kind === 'turso'`).
 * Both halves are production code; only the `new TursoDriver(...)` call is absent.
 */

import { describe, it, expect } from 'vitest';
import { validateDriverConfig } from '@objectstack/spec/data';
import {
  DatasourceAdminService,
  type DatasourceAdminServiceConfig,
  type StoredDatasource,
} from '../datasource-admin-service.js';
import {
  DatasourceConnectionService,
  type ConnectableDatasource,
  type ConnectionEngineLike,
} from '../datasource-connection-service.js';
import { buildTursoDriverConfig, resolveTursoUrl } from '../turso-driver-config.js';
import { createDefaultDatasourceDriverFactory } from '../default-datasource-driver-factory.js';
import type {
  DatasourceConnectionSpec,
  IDatasourceDriverFactory,
} from '../contracts/datasource-driver-factory.js';

const THE_BOUND_JWT = 'eyJhbGciOiJFZERTQSJ9.THE-BOUND-JWT';
const TURSO_URL = 'libsql://my-db.turso.io';

/**
 * An admin service over an in-memory record store and an in-memory secret store,
 * with the two joined the way a real host joins them: `writeSecret` returns an
 * opaque ref and keeps the cleartext where only a resolver can reach it. The
 * cleartext must never appear on the record — asserted below rather than assumed.
 */
function makeAuthoringDoor() {
  const records: StoredDatasource[] = [];
  const secrets = new Map<string, string>();
  let n = 0;
  const cfg: DatasourceAdminServiceConfig = {
    probe: async () => ({ ok: true }),
    listDatasourceRecords: async () => records,
    getDatasourceRecord: async (name) => records.find((r) => r.name === name),
    putDatasourceRecord: async (rec) => {
      const i = records.findIndex((r) => r.name === rec.name);
      if (i >= 0) records[i] = rec;
      else records.push(rec);
    },
    deleteDatasourceRecord: async () => {},
    writeSecret: async (input) => {
      const ref = `sys_secret:ds-${++n}`;
      secrets.set(ref, input.value);
      return ref;
    },
    countBoundObjects: async () => 0,
  };
  return { records, secrets, service: new DatasourceAdminService(cfg) };
}

/** The minimum engine the connect path needs to register a driver. */
function stubEngine(): ConnectionEngineLike {
  const drivers = new Map<string, { name?: string }>();
  return {
    registerDriver: (driver: any) => {
      drivers.set(driver.name, driver);
    },
    registerDatasourceDef: () => {},
    getDriverByName: (name) => drivers.get(name),
    syncObjectSchema: async () => {},
    markDatasourceUnavailable: () => {},
    clearDatasourceUnavailable: () => {},
  } as ConnectionEngineLike;
}

/**
 * A factory standing exactly where the real `turso` arm stands, recording the
 * spec it is handed. This is the seam described in the header — everything
 * upstream of it (door, binder, resolver) is production code.
 */
function capturingFactory() {
  const seen: DatasourceConnectionSpec[] = [];
  const factory: IDatasourceDriverFactory = {
    supports: () => true,
    create: async (spec) => {
      seen.push(spec);
      return { driver: { name: spec.name ?? 'default' } } as never;
    },
  };
  return { seen, factory };
}

/** Author a turso datasource through the real door, then connect it. */
async function authorThenConnect(secretValue: string) {
  const { records, secrets, service } = makeAuthoringDoor();
  await service.createDatasource(
    { name: 'warehouse', driver: 'turso', schemaMode: 'external', config: { url: TURSO_URL } },
    { value: secretValue },
  );

  const record = records[0]!;
  const { seen, factory } = capturingFactory();
  const connection = new DatasourceConnectionService({
    factory: () => factory,
    engine: () => stubEngine(),
    secrets: { resolve: async (ref) => secrets.get(ref) },
  });
  const result = await connection.connect(record as ConnectableDatasource);
  return { record, seen, result };
}

describe('#8152 — the credential route a NEW turso datasource has left', () => {
  it('RED ON MAIN — a datasource created with a bound secret reaches the driver with an authToken', async () => {
    const { record, seen, result } = await authorThenConnect(THE_BOUND_JWT);

    // The door did its job: an opaque ref on the record, no cleartext anywhere in
    // it. If this half ever fails the test below is measuring the wrong thing.
    expect(result.status).toBe('connected');
    expect(record.external?.credentialsRef).toMatch(/^sys_secret:/);
    expect(JSON.stringify(record)).not.toContain(THE_BOUND_JWT);

    // The connect path resolved the ref and handed the cleartext to the factory…
    expect(seen).toHaveLength(1);
    const spec = seen[0]!;
    expect(spec.secret).toBe(THE_BOUND_JWT);

    // …and the builder the turso arm calls puts it in the slot libSQL reads.
    // RED on main: this returned `{ url: 'libsql://my-db.turso.io' }`.
    expect(buildTursoDriverConfig(spec, resolveTursoUrl(spec))).toMatchObject({
      url: TURSO_URL,
      authToken: THE_BOUND_JWT,
    });
  });

  it('RED ON MAIN — the bound secret is the ONLY credential a newly authored datasource can carry', async () => {
    const { service } = makeAuthoringDoor();

    // Half one: the inline key is refused at the door (GREEN on main — #8078).
    await expect(
      service.createDatasource({
        name: 'inline', driver: 'turso',
        config: { url: TURSO_URL, authToken: THE_BOUND_JWT },
      } as never),
    ).rejects.toThrow(/is a credential and is not accepted inline/);

    // Half two: so the bound route must work, or there is none. RED on main.
    const { seen } = await authorThenConnect(THE_BOUND_JWT);
    const spec = seen[0]!;
    expect(buildTursoDriverConfig(spec, resolveTursoUrl(spec)).authToken).toBe(THE_BOUND_JWT);
  });

  // ⛔ Step 1 is one slot: the primary credential. `encryptionKey` is a different
  // secret (an AES-256 key for a local file, not a bearer token for a remote) and
  // whether the binder needs a second slot for it is deliberately undecided —
  // #8126's read-time redaction of it grants and removes no slot. This pin fails
  // if a later change reads the one bound secret as though it were both.
  //
  // Both halves asserted together on purpose: `not.toHaveProperty` alone is
  // green on main for the useless reason (main emitted neither key), which is
  // exactly the vacuity this file is written to avoid. RED on main.
  it('RED ON MAIN — binds the secret to authToken alone, leaving the encryptionKey question open', async () => {
    const { seen } = await authorThenConnect(THE_BOUND_JWT);
    const config = buildTursoDriverConfig(seen[0]!, resolveTursoUrl(seen[0]!));
    expect(config.authToken).toBe(THE_BOUND_JWT);
    expect(config).not.toHaveProperty('encryptionKey');
  });
});

describe('GREEN ON MAIN — #8078 is not reopened by the route this card restores', () => {
  it('the inline refusal still fires at create and at update', async () => {
    const { service } = makeAuthoringDoor();
    await expect(
      service.createDatasource({
        name: 'inline', driver: 'turso', config: { url: TURSO_URL, authToken: 'jwt' },
      } as never),
    ).rejects.toThrow(/is a credential and is not accepted inline/);

    // An existing row is not a licence to type the key back in. `updateDatasource`
    // judges the MERGED config, so a patch that reintroduces it is refused too.
    await service.createDatasource(
      { name: 'warehouse', driver: 'turso', config: { url: TURSO_URL } },
      { value: THE_BOUND_JWT },
    );
    await expect(
      service.updateDatasource('warehouse', {
        config: { url: TURSO_URL, authToken: 'jwt' },
      } as never),
    ).rejects.toThrow(/is a credential and is not accepted inline/);
  });

  it('the refusal still names both mechanisms it diverts to', () => {
    // The guidance is what makes the refusal actionable — and as of this card the
    // route it names is one that actually delivers the credential. A refusal that
    // said only "not allowed" would leave the author with no next move.
    const verdict = validateDriverConfig('turso', { url: TURSO_URL, authToken: 'jwt' });
    expect(verdict).toMatchObject({ known: true });
    const message = (verdict as { issues: Array<{ message: string }> }).issues[0]!.message;
    expect(message).toContain('external.credentialsRef');
    expect(message).toContain('secret binder');
  });

  it('a turso config with no credential at all is still accepted', () => {
    // The url-only shape is what a bound datasource stores. It must stay legal:
    // if this went red, binding would be unreachable for a different reason.
    expect(validateDriverConfig('turso', { url: TURSO_URL })).toEqual({ known: true, issues: [] });
  });
});

describe('GREEN ON MAIN — the sibling arms this change takes its shape from are unchanged', () => {
  /** The knex config a constructed SqlDriver was built from. */
  function knexConfigOf(driver: any): any {
    return driver?.config ?? driver?.knexConfig ?? driver?.options ?? {};
  }

  const factory = () => createDefaultDatasourceDriverFactory({ dev: false });

  it('postgres still reads spec.secret as the connection password', async () => {
    const handle: any = await factory().create({
      driver: 'postgres',
      config: { host: 'db.internal', database: 'analytics', username: 'admin' },
      secret: 'hunter2',
    });
    expect(knexConfigOf(handle.driver ?? handle).connection).toMatchObject({ password: 'hunter2' });
    try { await handle.disconnect?.(); } catch { /* pool never opened */ }
  });

  it('postgres still lets the bound secret win over an inline config.password', async () => {
    const handle: any = await factory().create({
      driver: 'postgres',
      config: { host: 'db.internal', database: 'analytics', username: 'admin', password: 'stale' },
      secret: 'hunter2',
    });
    expect(knexConfigOf(handle.driver ?? handle).connection).toMatchObject({ password: 'hunter2' });
    try { await handle.disconnect?.(); } catch { /* pool never opened */ }
  });

  it('mysql still reads spec.secret as the connection password', async () => {
    const handle: any = await factory().create({
      driver: 'mysql',
      config: { host: 'db.internal', database: 'analytics', username: 'admin' },
      secret: 'hunter2',
    });
    expect(knexConfigOf(handle.driver ?? handle).connection).toMatchObject({ password: 'hunter2' });
    try { await handle.disconnect?.(); } catch { /* pool never opened */ }
  });

  it('mongodb still reads spec.secret into the connection url', async () => {
    const handle: any = await factory().create({
      driver: 'mongodb',
      config: { host: 'db.internal', port: 27017, database: 'analytics', username: 'admin' },
      secret: 'hunter2',
    });
    const driver: any = handle.driver ?? handle;
    const url = driver?.config?.url ?? driver?.options?.url ?? driver?.url;
    expect(url).toBe('mongodb://admin:hunter2@db.internal:27017/analytics');
    try { await handle.disconnect?.(); } catch { /* client never opened */ }
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31796] The `credential_use` row, on a real engine: `ObjectQLPlugin` and
 * `AuditPlugin` booted in a real kernel over a real driver, the credential
 * objects as the platform declares them, and every API-key admission driven
 * through the REAL shared key-admission seam of `@objectstack/core`, by the
 * call each door makes:
 *
 *  - REST: `resolveRequestExecutionContext`, fail-closed entry, `Bearer` key;
 *  - the runtime dispatcher's `/mcp` face: the same function, guest entry;
 *  - the stdio MCP transport: `resolveAuthzContext` with the one header it sends;
 *  - the storage doors: `resolveApiKeyAdmission` directly.
 *
 * An OAuth access token's use is the consent's last-use stamp, written here
 * exactly as plugin-auth's store writes it (`mcp-client-last-use.ts`
 * `mcpClientLastUseStoreFor`: a system update of `last_used_at` with the hour
 * start); plugin-auth's own real-engine file pins that its stamper writes it
 * once per consent per hour. A `skip_consent` client's use arrives through
 * the `audit` slot, as plugin-auth hands it on.
 *
 * What is pinned:
 *
 *  - an API key and an OAuth token each leave one row naming the principal and
 *    the credential id;
 *  - a second admission in the window writes no row; the first after it does;
 *  - no row carries the key, its hash or the token;
 *  - all four doors count;
 *  - CONTROL: the admission verdict, the resolved context and the stamped key
 *    row are byte-identical with and without the ledger, and the ledger never
 *    makes the stamp fail.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import {
  ObjectKernel,
  hashApiKey,
  resolveApiKeyAdmission,
  resolveAuthzContext,
  resolveRequestExecutionContext,
  runWithCredentialUseClient,
  API_KEY_LAST_USED_STAMP_INTERVAL_MS,
} from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { SysApiKey, SysOauthApplication, SysOauthConsent, SysUser } from '@objectstack/platform-objects/identity';

import { AuditPlugin } from './audit-plugin.js';
import { CREDENTIAL_USE_AUDIT_ACTION, type CredentialUseAuditWriter } from './credential-use-audit.js';

const SYS = { context: { isSystem: true } } as const;
const LEDGER = 'sys_audit_log';
const USER = 'usr_31796';
const ORG = 'org_31796';
const MINUTE = 60_000;
const T0 = Date.parse('2026-11-09T10:05:00.000Z');

type Row = Record<string, any>;

interface Rig {
  kernel: ObjectKernel;
  engine: ObjectQL;
}

async function boot(withAudit: boolean): Promise<Rig> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' } });
  await kernel.use(new ObjectQLPlugin());
  if (withAudit) await kernel.use(new AuditPlugin());
  await kernel.bootstrap();
  const engine = kernel.getService<ObjectQL>('objectql');
  const driver = new SqliteWasmDriver({ filename: ':memory:' });
  await driver.connect();
  engine.registerDriver(driver, true);
  for (const object of [SysUser, SysApiKey, SysOauthConsent, SysOauthApplication]) {
    engine.registry.registerObject(object as any, 'com.objectstack.audit.test.credential-use');
  }
  await engine.syncSchemas();
  await engine.insert('sys_user', { id: USER, email: 'cu@credential-use.example.com', name: 'Cu' }, SYS);
  return { kernel, engine };
}

/** A key as the `/keys` door mints it: only the hash is stored. Returns the raw key. */
async function mintKey(engine: ObjectQL, id: string, organizationId: string | null = ORG): Promise<string> {
  const raw = `osk_${id}_${'s3cr3t'.repeat(4)}`;
  await engine.insert(
    'sys_api_key',
    {
      id,
      name: `key ${id}`,
      user_id: USER,
      key: hashApiKey(raw),
      prefix: 'osk_',
      revoked: false,
      ...(organizationId ? { active_organization_id: organizationId } : {}),
    },
    SYS,
  );
  return raw;
}

const credentialUseRows = async (engine: ObjectQL): Promise<Row[]> =>
  (await engine.find(LEDGER, { where: { action: CREDENTIAL_USE_AUDIT_ACTION }, ...SYS })) as Row[];

const metadataOf = (row: Row): Record<string, unknown> =>
  typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata ?? {});

/**
 * The engine as an authorization resolver reads it on a deployment whose
 * permission tables are not provisioned: a read of an object this rig did not
 * register answers as the driver's missing table, the one read failure the
 * resolver treats as "no rows" (`tryFind`). Every write, and so every hook,
 * goes to the real engine.
 */
function unprovisionedReads(engine: ObjectQL): ObjectQL {
  return new Proxy(engine, {
    get(target, prop) {
      if (prop === 'find') {
        return async (object: string, ...rest: unknown[]) => {
          if (!target.registry.getObject(object)) throw new Error(`SQLITE_ERROR: no such table: ${object}`);
          return (target.find as any)(object, ...rest);
        };
      }
      const value = (target as any)[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** The four doors, each by the call it makes into the shared key-admission seam. */
const DOORS: Record<string, (engine: ObjectQL, raw: string) => Promise<string | undefined>> = {
  rest: async (engine, raw) => {
    const ctx = await resolveRequestExecutionContext({
      headers: new Headers({ authorization: `Bearer ${raw}` }),
      ql: unprovisionedReads(engine),
      authService: undefined,
      tenancy: undefined,
      anonymous: 'fail-closed',
      authGate: 'resolved',
      credentials: 'api-key-and-session',
      sessionApi: 'optional',
      session: 'request',
      localization: 'withhold',
      requestLocale: undefined,
      accessToken: 'withhold',
      oauth: undefined,
      onAdmission: undefined,
    });
    return ctx?.userId;
  },
  mcp: async (engine, raw) => {
    const ctx = await resolveRequestExecutionContext({
      headers: new Headers({ authorization: `Bearer ${raw}` }),
      ql: unprovisionedReads(engine),
      authService: undefined,
      tenancy: undefined,
      anonymous: 'guest',
      authGate: 'withhold',
      credentials: 'api-key-and-session',
      sessionApi: 'optional',
      session: 'request',
      localization: 'withhold',
      requestLocale: undefined,
      accessToken: 'carry',
      oauth: undefined,
      onAdmission: undefined,
    });
    return ctx?.userId;
  },
  stdio: async (engine, raw) =>
    (
      await resolveAuthzContext({
        ql: unprovisionedReads(engine),
        headers: { 'x-api-key': raw },
        tenancyPosture: undefined,
        userAuthGates: undefined,
        apiKeyLifecycle: undefined,
      })
    ).userId,
  storage: async (engine, raw) => {
    const admission = await resolveApiKeyAdmission(engine, { 'x-api-key': raw }, Date.now(), undefined, undefined, undefined);
    return admission.outcome === 'admitted' ? admission.principal.userId : undefined;
  },
};

let audited: Rig;
let plain: Rig;

beforeAll(async () => {
  audited = await boot(true);
  plain = await boot(false);
}, 120_000);

afterAll(async () => {
  for (const rig of [audited, plain]) {
    if (rig) await Promise.race([rig.kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }
}, 30_000);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('[#31796] an API key admitting a request leaves one credential_use row per window', () => {
  it('names the principal, the key id and the kind, and never the key, its hash or a prefix', async () => {
    const raw = await mintKey(audited.engine, 'key_shape');
    expect(await DOORS.storage(audited.engine, raw)).toBe(USER);

    const rows = (await credentialUseRows(audited.engine)).filter((r) => r.record_id === 'key_shape');
    expect(rows).toHaveLength(1);
    const [row] = rows;
    const stored = JSON.stringify(row);
    expect(stored).not.toContain(raw);
    expect(stored).not.toContain(hashApiKey(raw));
    expect(stored).not.toContain('s3cr3t');
    expect(stored).not.toContain('osk_');
    expect(row).toMatchObject({
      action: 'credential_use',
      user_id: USER,
      actor: USER,
      object_name: 'sys_api_key',
      record_id: 'key_shape',
      tenant_id: ORG,
      ip_address: null,
      user_agent: null,
      old_value: null,
      new_value: null,
    });
    expect(metadataOf(row)).toEqual({
      credential_kind: 'api_key',
      credential_id: 'key_shape',
      used_at: new Date(T0).toISOString(),
      // [#31821] The storage door hands no client facts.
      ip_address_absent: 'not_supplied',
    });
  });

  it('a second admission inside the window writes no row; the first after the window writes one', async () => {
    const raw = await mintKey(audited.engine, 'key_window');
    const count = async () =>
      (await credentialUseRows(audited.engine)).filter((r) => r.record_id === 'key_window').length;

    await DOORS.storage(audited.engine, raw);
    expect(await count()).toBe(1);

    vi.setSystemTime(T0 + 5 * MINUTE);
    for (let i = 0; i < 5; i++) await DOORS.storage(audited.engine, raw);
    vi.setSystemTime(T0 + API_KEY_LAST_USED_STAMP_INTERVAL_MS - MINUTE);
    await DOORS.storage(audited.engine, raw);
    expect(await count(), 'seven admissions inside one window').toBe(1);

    vi.setSystemTime(T0 + API_KEY_LAST_USED_STAMP_INTERVAL_MS + MINUTE);
    await DOORS.storage(audited.engine, raw);
    expect(await count(), 'the first admission after the window').toBe(2);
    const usedAt = (await credentialUseRows(audited.engine))
      .filter((r) => r.record_id === 'key_window')
      .map((r) => metadataOf(r).used_at)
      .sort();
    expect(usedAt).toEqual([
      new Date(T0).toISOString(),
      new Date(T0 + API_KEY_LAST_USED_STAMP_INTERVAL_MS + MINUTE).toISOString(),
    ]);
  });

  it.each(Object.keys(DOORS))('the %s door counts', async (door) => {
    const id = `key_door_${door}`;
    const raw = await mintKey(audited.engine, id);
    expect(await DOORS[door](audited.engine, raw)).toBe(USER);
    const rows = (await credentialUseRows(audited.engine)).filter((r) => r.record_id === id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: USER, object_name: 'sys_api_key' });
  });

  it('a key bound to no organization writes a deployment-level row', async () => {
    const raw = await mintKey(audited.engine, 'key_orgless', null);
    await DOORS.storage(audited.engine, raw);
    const [row] = (await credentialUseRows(audited.engine)).filter((r) => r.record_id === 'key_orgless');
    expect(row.tenant_id ?? null).toBeNull();
  });

  it('an update of the key that is not the use stamp writes no row', async () => {
    await mintKey(audited.engine, 'key_edits');
    await audited.engine.update('sys_api_key', { id: 'key_edits', name: 'renamed' }, SYS);
    await audited.engine.update(
      'sys_api_key',
      { id: 'key_edits', revoked: true, last_used_at: new Date(T0).toISOString() },
      SYS,
    );
    expect((await credentialUseRows(audited.engine)).filter((r) => r.record_id === 'key_edits')).toEqual([]);
  });
});

describe('[#31796] CONTROL: the ledger changes no admission', () => {
  // Its own pair of engines: core says a failed stamp ONCE per data engine, so
  // on an engine an earlier test already stamped, a ledger that broke the stamp
  // would leave nothing for this pin to see.
  let fresh: { audited: Rig; plain: Rig };
  beforeAll(async () => {
    fresh = { audited: await boot(true), plain: await boot(false) };
  }, 120_000);
  afterAll(async () => {
    for (const rig of [fresh?.audited, fresh?.plain]) {
      if (rig) await Promise.race([rig.kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }
  }, 30_000);

  it('the verdict, the resolved context and the stamped key row are identical with and without it', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const answers: unknown[][] = [];
    for (const rig of [fresh.audited, fresh.plain]) {
      const raw = await mintKey(rig.engine, 'key_control');
      vi.setSystemTime(T0);
      const admission = await resolveApiKeyAdmission(rig.engine, { 'x-api-key': raw }, T0, undefined, undefined, undefined);
      vi.setSystemTime(T0 + 2 * MINUTE);
      const authz = await resolveAuthzContext({
        ql: unprovisionedReads(rig.engine),
        headers: { 'x-api-key': raw },
        tenancyPosture: undefined,
        userAuthGates: undefined,
        apiKeyLifecycle: undefined,
      });
      const [keyRow] = (await rig.engine.find('sys_api_key', {
        where: { id: 'key_control' },
        fields: ['id', 'user_id', 'active_organization_id', 'last_used_at', 'expires_at', 'revoked'],
        ...SYS,
      })) as Row[];
      answers.push([admission, authz, keyRow]);
    }
    expect(JSON.stringify(answers[0])).toBe(JSON.stringify(answers[1]));
    expect((answers[0][0] as { outcome: string }).outcome).toBe('admitted');
    // The ledger never made the stamp fail, and its row landed on the audited side.
    expect(errors.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('API key use NOT recorded'))).toEqual([]);
    expect((await credentialUseRows(fresh.audited.engine)).filter((r) => r.record_id === 'key_control')).toHaveLength(1);
  });
});

describe('[#31796] an OAuth access token\'s use leaves one credential_use row per window', () => {
  const HOUR_10 = Date.parse('2026-11-09T10:00:00.000Z');
  const HOUR_11 = Date.parse('2026-11-09T11:00:00.000Z');

  /** The consent's stamp, exactly as plugin-auth's store writes it. */
  const stamp = (engine: ObjectQL, consentId: string, hour: number) =>
    engine.update('sys_oauth_consent', { id: consentId, last_used_at: new Date(hour) }, SYS);

  it('the consent\'s hourly stamp writes one row naming the principal, the consent and the client', async () => {
    await audited.engine.insert(
      'sys_oauth_consent',
      { id: 'consent_a', client_id: 'client_31796', user_id: USER, reference_id: ORG, scopes: '["data:read"]' },
      SYS,
    );
    const count = async () =>
      (await credentialUseRows(audited.engine)).filter((r) => r.record_id === 'consent_a');

    await stamp(audited.engine, 'consent_a', HOUR_10);
    const [row] = await count();
    expect(row).toMatchObject({
      action: 'credential_use',
      user_id: USER,
      actor: USER,
      object_name: 'sys_oauth_consent',
      record_id: 'consent_a',
      tenant_id: ORG,
      ip_address: null,
      user_agent: null,
    });
    expect(metadataOf(row)).toEqual({
      credential_kind: 'oauth_access_token',
      credential_id: 'consent_a',
      used_at: new Date(HOUR_10).toISOString(),
      client_id: 'client_31796',
      // [#31821] Stamped outside any client-facts scope.
      ip_address_absent: 'not_supplied',
    });

    // The next hour's stamp: one more row.
    await stamp(audited.engine, 'consent_a', HOUR_11);
    expect(await count()).toHaveLength(2);
  });

  it('a consent update that is not the use stamp writes no row', async () => {
    await audited.engine.insert(
      'sys_oauth_consent',
      { id: 'consent_b', client_id: 'client_31796', user_id: USER, scopes: '["data:read"]' },
      SYS,
    );
    await audited.engine.update('sys_oauth_consent', { id: 'consent_b', scopes: '["data:write"]' }, SYS);
    expect((await credentialUseRows(audited.engine)).filter((r) => r.record_id === 'consent_b')).toEqual([]);
  });

  it('a skip_consent client\'s use, handed on through the audit slot, writes one row naming its application', async () => {
    const audit = audited.kernel.getService<CredentialUseAuditWriter>('audit');
    await audit.recordCredentialUse({
      kind: 'oauth_access_token',
      objectName: 'sys_oauth_application',
      credentialId: 'app_31796',
      userId: USER,
      clientId: 'client_skip_31796',
      usedAt: new Date(HOUR_10).toISOString(),
    });
    // A kind that does not match the object, and an unknown object, write nothing.
    await audit.recordCredentialUse({
      kind: 'api_key',
      objectName: 'sys_oauth_application',
      credentialId: 'app_31796',
      userId: USER,
    });
    await audit.recordCredentialUse({
      kind: 'oauth_access_token',
      objectName: 'sys_user',
      credentialId: USER,
      userId: USER,
    } as never);
    const rows = (await credentialUseRows(audited.engine)).filter((r) => r.object_name !== 'sys_api_key' && r.object_name !== 'sys_oauth_consent');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: USER, object_name: 'sys_oauth_application', record_id: 'app_31796' });
    expect(rows[0].tenant_id ?? null).toBeNull();
    expect(metadataOf(rows[0])).toEqual({
      credential_kind: 'oauth_access_token',
      credential_id: 'app_31796',
      used_at: new Date(HOUR_10).toISOString(),
      client_id: 'client_skip_31796',
      // [#31821] The hand-off carried no client facts.
      ip_address_absent: 'not_supplied',
    });
  });
});

/**
 * [#31821] Where the use came from: the row's `ip_address` and `user_agent`,
 * and, when there is no address, why (`metadata.ip_address_absent`).
 *
 * The address is the auth service's answer (`IAuthService.resolveClientAddress`,
 * the deployment's trust rule, pinned with the real rule on the dispatcher and
 * in plugin-auth). Here the auth service is a double that records what the door
 * handed it and answers a fixed address, so what is pinned is the carriage:
 * door facts → the stamp's scope → this row.
 */
describe('[#31821] the credential_use row records where the use came from', () => {
  const PEER = '203.0.113.7';
  const UA = 'ci-agent/3.1 (+31821)';

  /** An auth service that establishes `address`, remembering every transport it was handed. */
  function addressAuthority(address: string | undefined) {
    const handed: Array<{ headers?: Record<string, unknown>; remoteAddress?: string }> = [];
    return {
      handed,
      service: {
        resolveClientAddress: (transport: { headers?: Record<string, unknown>; remoteAddress?: string }) => {
          handed.push(transport);
          return address;
        },
      },
    };
  }

  /** The composition REST and the dispatcher call, with the facts the door hands over. */
  const compose = (
    engine: ObjectQL,
    raw: string,
    opts: { anonymous: 'fail-closed' | 'guest'; authService: unknown; remoteAddress?: string; transport?: boolean },
  ) =>
    resolveRequestExecutionContext({
      headers: new Headers({ authorization: `Bearer ${raw}`, 'user-agent': UA, 'x-forwarded-for': '198.51.100.99' }),
      ql: unprovisionedReads(engine),
      authService: opts.authService as never,
      tenancy: undefined,
      anonymous: opts.anonymous,
      authGate: opts.anonymous === 'guest' ? 'withhold' : 'resolved',
      credentials: 'api-key-and-session',
      sessionApi: 'optional',
      session: 'request',
      localization: 'withhold',
      requestLocale: undefined,
      accessToken: opts.anonymous === 'guest' ? 'carry' : 'withhold',
      oauth: undefined,
      onAdmission: undefined,
      ...(opts.transport === false ? {} : { transport: { remoteAddress: opts.remoteAddress } }),
    });

  const rowOf = async (id: string): Promise<Row> => {
    const rows = (await credentialUseRows(audited.engine)).filter((r) => r.record_id === id);
    expect(rows, `credential_use rows for ${id}`).toHaveLength(1);
    return rows[0];
  };

  it.each([
    ['rest', 'fail-closed'],
    ['mcp', 'guest'],
  ] as const)('the %s composition: the row carries the address the auth service established and the user agent', async (door, anonymous) => {
    const id = `key_client_${door}`;
    const raw = await mintKey(audited.engine, id);
    const authority = addressAuthority(PEER);
    const ctx = await compose(audited.engine, raw, { anonymous, authService: authority.service, remoteAddress: '10.0.0.5' });
    expect(ctx?.userId).toBe(USER);

    // The door handed the auth service the peer address and the headers; it
    // read no forwarded header itself.
    expect(authority.handed).toHaveLength(1);
    expect(authority.handed[0].remoteAddress).toBe('10.0.0.5');
    expect(authority.handed[0].headers?.['x-forwarded-for']).toBe('198.51.100.99');

    const row = await rowOf(id);
    expect(row).toMatchObject({ ip_address: PEER, user_agent: UA });
    expect(metadataOf(row)).not.toHaveProperty('ip_address_absent');
    // CONTROL: no credential material on the row, the presented header included.
    const stored = JSON.stringify(row);
    for (const secret of [raw, hashApiKey(raw), 's3cr3t', 'osk_', 'Bearer']) expect(stored).not.toContain(secret);
  });

  it('the stdio transport: no address and no user agent, with the reason `stdio`', async () => {
    const raw = await mintKey(audited.engine, 'key_client_stdio');
    const authz = await resolveAuthzContext({
      ql: unprovisionedReads(audited.engine),
      headers: { 'x-api-key': raw },
      tenancyPosture: undefined,
      userAuthGates: undefined,
      apiKeyLifecycle: undefined,
      client: { transport: 'stdio' },
    });
    expect(authz.userId).toBe(USER);
    const row = await rowOf('key_client_stdio');
    expect(row.ip_address ?? null).toBeNull();
    expect(row.user_agent ?? null).toBeNull();
    expect(metadataOf(row).ip_address_absent).toBe('stdio');
  });

  it('a door that hands no facts: no address, with the reason `not_supplied`; the user agent is still read', async () => {
    const raw = await mintKey(audited.engine, 'key_client_unwired');
    const authority = addressAuthority(PEER);
    await compose(audited.engine, raw, { anonymous: 'fail-closed', authService: authority.service, transport: false });
    expect(authority.handed, 'no facts handed, so nothing is asked').toHaveLength(0);
    const row = await rowOf('key_client_unwired');
    expect(row.ip_address ?? null).toBeNull();
    expect(row.user_agent).toBe(UA);
    expect(metadataOf(row).ip_address_absent).toBe('not_supplied');
  });

  it('the trust rule establishes no address: no address, with the reason `undetermined`', async () => {
    const raw = await mintKey(audited.engine, 'key_client_undetermined');
    await compose(audited.engine, raw, { anonymous: 'fail-closed', authService: addressAuthority(undefined).service });
    const row = await rowOf('key_client_undetermined');
    expect(row.ip_address ?? null).toBeNull();
    expect(metadataOf(row).ip_address_absent).toBe('undetermined');
  });

  it('an established value wider than the address column is not stored, with the reason `unrecordable`', async () => {
    const raw = await mintKey(audited.engine, 'key_client_wide');
    await compose(audited.engine, raw, { anonymous: 'fail-closed', authService: addressAuthority('x'.repeat(46)).service });
    const row = await rowOf('key_client_wide');
    expect(row.ip_address ?? null).toBeNull();
    expect(row.user_agent).toBe(UA);
    expect(metadataOf(row).ip_address_absent).toBe('unrecordable');
  });

  it('a stamp written outside any scope records `not_supplied`, never a guess', async () => {
    await mintKey(audited.engine, 'key_client_bare');
    await audited.engine.update('sys_api_key', { id: 'key_client_bare', last_used_at: new Date(T0).toISOString() }, SYS);
    const row = await rowOf('key_client_bare');
    expect(row.ip_address ?? null).toBeNull();
    expect(row.user_agent ?? null).toBeNull();
    expect(metadataOf(row).ip_address_absent).toBe('not_supplied');
  });

  it('an OAuth consent stamp written inside the use\'s scope records its facts', async () => {
    await audited.engine.insert(
      'sys_oauth_consent',
      { id: 'consent_client', client_id: 'client_31821', user_id: USER, reference_id: ORG, scopes: '["data:read"]' },
      SYS,
    );
    await runWithCredentialUseClient({ ipAddress: PEER, userAgent: UA }, () =>
      audited.engine.update('sys_oauth_consent', { id: 'consent_client', last_used_at: new Date(T0) }, SYS),
    );
    const row = await rowOf('consent_client');
    expect(row).toMatchObject({ ip_address: PEER, user_agent: UA, object_name: 'sys_oauth_consent' });
  });

  it('a skip_consent client\'s use carries its facts on the hand-off', async () => {
    const audit = audited.kernel.getService<CredentialUseAuditWriter>('audit');
    await audit.recordCredentialUse({
      kind: 'oauth_access_token',
      objectName: 'sys_oauth_application',
      credentialId: 'app_31821',
      userId: USER,
      clientId: 'client_skip_31821',
      client: { ipAddress: PEER, userAgent: UA },
    });
    const row = await rowOf('app_31821');
    expect(row).toMatchObject({ ip_address: PEER, user_agent: UA });
  });

  it('CONTROL: the throttle is unchanged; a second use in the window from another address writes no row, and the row keeps the first use\'s facts', async () => {
    const raw = await mintKey(audited.engine, 'key_client_window');
    await compose(audited.engine, raw, { anonymous: 'fail-closed', authService: addressAuthority(PEER).service });
    vi.setSystemTime(T0 + 10 * MINUTE);
    await compose(audited.engine, raw, { anonymous: 'fail-closed', authService: addressAuthority('192.0.2.200').service });
    const row = await rowOf('key_client_window');
    expect(row.ip_address).toBe(PEER);

    vi.setSystemTime(T0 + API_KEY_LAST_USED_STAMP_INTERVAL_MS + MINUTE);
    await compose(audited.engine, raw, { anonymous: 'fail-closed', authService: addressAuthority('192.0.2.200').service });
    const rows = (await credentialUseRows(audited.engine)).filter((r) => r.record_id === 'key_client_window');
    expect(rows.map((r) => r.ip_address).sort()).toEqual(['192.0.2.200', PEER].sort());
  });
});

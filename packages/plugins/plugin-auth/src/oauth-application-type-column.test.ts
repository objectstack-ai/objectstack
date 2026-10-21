// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25053] What `sys_oauth_application.type`'s two declared values, `web` and
 * `native`, mean for stored rows and for writes.
 *
 * `platform-objects` declares the column with exactly the values its one
 * writer, `@better-auth/oauth-provider`, produces (its own
 * `sys-oauth-application.type-options.test.ts` pins the declaration). The
 * former `useragentbased` and `public` options had no writer, and a row an
 * earlier provider line stored as `user-agent-based` never held a declared
 * value. Rows are not rewritten, so this file pins the two halves of the
 * narrowing on a real engine:
 *
 *  - A stored row reads, lists and takes every write that leaves `type` out,
 *    whatever `type` it holds: the record validator judges only the keys a
 *    write sends. That covers the provider's own secret rotation and the
 *    enable/disable bridge's `disabled` write.
 *  - A write that SENDS a value outside the two is refused with
 *    `VALIDATION_FAILED` (400 at an HTTP boundary) and an `invalid_option`
 *    finding on `type`, and nothing is written. `null` is a blank value and is
 *    accepted. No door sends another value today (the provider writes `web`,
 *    `native` or `null`; the generic data API answers 405 on this table), so
 *    the refusal guards the declaration rather than a live caller.
 *
 * Driven against a REAL ObjectQL engine on SQLite with the auth manifest's own
 * objects, and REAL better-auth with the OIDC provider on. Rows are seeded and
 * read back at driver level, below every engine read mask. Writes go through
 * the engine with the system context plugin-auth's adapter writes under.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveThrownHttpError } from '@objectstack/types';
import { AuthManager } from './auth-manager';
import { authIdentityObjects } from './manifest';

const SECRET = 'test-secret-at-least-32-chars-long-25053';
const PASSWORD = 'S3cure!Passw0rd-25053-type';
const EMAIL = 'owner.type.25053@example.com';
const ORIGIN = 'http://localhost:3000';
const CLIENTS = 'sys_oauth_application';
const SYSTEM = { context: { isSystem: true } };

/** Stored values no declaration holds after #25053; the first was never declared. */
const UNDECLARED = ['user-agent-based', 'useragentbased', 'public'] as const;
/** Every value a stored row may hold: the two declared ones, a blank, and the undeclared ones. */
const STORED = ['web', 'native', null, ...UNDECLARED] as const;

/** The three authorization objects a real sign-in reads (as `oauth-register-application-type.test.ts`). */
const AUTHZ_OBJECTS = [
  {
    name: 'sys_user_position',
    label: 'User Position',
    fields: {
      id: { name: 'id', type: 'text' as const, primaryKey: true },
      user_id: { name: 'user_id', type: 'text' as const },
      position: { name: 'position', type: 'text' as const },
      organization_id: { name: 'organization_id', type: 'text' as const },
    },
  },
  {
    name: 'sys_user_permission_set',
    label: 'User Permission Set',
    fields: {
      id: { name: 'id', type: 'text' as const, primaryKey: true },
      user_id: { name: 'user_id', type: 'text' as const },
      permission_set_id: { name: 'permission_set_id', type: 'text' as const },
      organization_id: { name: 'organization_id', type: 'text' as const },
    },
  },
  {
    name: 'sys_position',
    label: 'Position',
    fields: {
      id: { name: 'id', type: 'text' as const, primaryKey: true },
      name: { name: 'name', type: 'text' as const },
      label: { name: 'label', type: 'text' as const },
      active: { name: 'active', type: 'boolean' as const },
      organization_id: { name: 'organization_id', type: 'text' as const },
    },
  },
];

type Row = Record<string, unknown>;

let engine: ObjectQL;
let manager: AuthManager;
let cookie: string;
let ownerId: string;

const driver = () =>
  (engine as unknown as {
    getDriver(o: string): {
      find(o: string, q: unknown): Promise<unknown>;
      create(o: string, d: Row): Promise<unknown>;
    };
  }).getDriver(CLIENTS);

/** The stored row, read at DRIVER level. */
async function stored(id: string): Promise<Row | undefined> {
  const found = await driver().find(CLIENTS, { where: { id } });
  return ((Array.isArray(found) ? found : [found]).filter(Boolean) as Row[])[0];
}

const label = (value: string | null) => (value === null ? 'null' : value.replace(/-/g, '_'));

/** Seed one client row at driver level, below the validator, as an earlier writer left it. */
async function seed(tag: string, type: string | null): Promise<{ id: string; clientId: string }> {
  const id = `oauthc_25053_${tag}`;
  const clientId = `c25053-${tag}`;
  const now = new Date().toISOString();
  await driver().create(CLIENTS, {
    id,
    name: `seeded ${tag}`,
    client_id: clientId,
    client_secret: `digest-${tag}`,
    type,
    user_id: ownerId,
    redirect_uris: JSON.stringify(['https://app.example.com/callback']),
    grant_types: JSON.stringify(['authorization_code', 'refresh_token']),
    response_types: JSON.stringify(['code']),
    token_endpoint_auth_method: 'client_secret_basic',
    disabled: false,
    created_at: now,
    updated_at: now,
  });
  expect((await stored(id))?.type, `seeded ${tag}`).toBe(type);
  return { id, clientId };
}

/** The refusal a write sending an undeclared `type` gets, as an HTTP boundary answers it. */
async function expectTypeRefused(write: () => Promise<unknown>) {
  const thrown = await write().then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(thrown, 'the write was accepted').toBeDefined();
  const answer = resolveThrownHttpError(thrown);
  expect(answer.code).toBe('VALIDATION_FAILED');
  expect(answer.status).toBe(400);
  expect(answer.details?.fields).toEqual([expect.objectContaining({ field: 'type', code: 'invalid_option' })]);
}

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const object of authIdentityObjects) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  for (const object of AUTHZ_OBJECTS) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-security');
  }
  await engine.syncSchemas();

  manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine as never,
    plugins: { oidcProvider: true },
  } as unknown as ConstructorParameters<typeof AuthManager>[0]);

  const direct = (path: string, body: unknown) =>
    manager.handleRequest(
      new Request(`${ORIGIN}/api/v1/auth${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: ORIGIN },
        body: JSON.stringify(body),
      }),
    );
  const signUp = await direct('/sign-up/email', { email: EMAIL, password: PASSWORD, name: 'Client Owner' });
  expect(signUp.status, `sign-up: ${await signUp.clone().text()}`).toBe(200);
  const signIn = await direct('/sign-in/email', { email: EMAIL, password: PASSWORD });
  expect(signIn.status, `sign-in: ${await signIn.clone().text()}`).toBe(200);
  ownerId = ((await signIn.clone().json()) as { user?: { id?: string } }).user?.id ?? '';
  expect(ownerId, 'sign-in names its user').not.toBe('');
  const staged = signIn.headers.getSetCookie().find((c) => /(?:^|\.)session_token=/.test(c.split(';')[0]));
  if (!staged) throw new Error('sign-in staged no session cookie');
  cookie = staged.split(';')[0];
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await (engine as unknown as { destroy?(): Promise<void> })?.destroy?.();
});

describe('[#25053] a stored row reads and lists whatever `type` it holds', () => {
  it.each(STORED)('type %s: the record read and the list read return the stored value', async (type) => {
    const { id, clientId } = await seed(`read_${label(type)}`, type);
    const record = await engine.findOne(CLIENTS, { where: { id }, ...SYSTEM });
    expect(record?.type ?? null).toBe(type);
    const listed = (await engine.find(CLIENTS, { where: { client_id: clientId }, ...SYSTEM })) as Row[];
    expect(listed.map((row) => row.type ?? null)).toEqual([type]);
  });

  it.each(STORED)('type %s: the provider reads the client back with its stored type', async (type) => {
    const { clientId } = await seed(`provider_read_${label(type)}`, type);
    const api = (await manager.getApi()) as unknown as {
      getOAuthClient(input: unknown): Promise<{ client_id?: unknown; application_type?: unknown }>;
    };
    const client = await api.getOAuthClient({ query: { client_id: clientId }, headers: new Headers({ cookie }) });
    expect(client.client_id).toBe(clientId);
    expect(client.application_type ?? null).toBe(type);
  });
});

describe('[#25053] a stored row takes every write that leaves `type` out', () => {
  it.each(STORED)('type %s: the enable/disable bridge\'s `disabled` write is accepted, the type unchanged', async (type) => {
    const { id } = await seed(`disable_${label(type)}`, type);
    await engine.update(CLIENTS, { id, disabled: true }, SYSTEM);
    const row = await stored(id);
    expect(row?.disabled).toBeTruthy();
    expect(row?.type).toBe(type);
  });

  it.each(STORED)('type %s: the provider rotates the client secret, the type unchanged', async (type) => {
    const { id, clientId } = await seed(`rotate_${label(type)}`, type);
    const api = (await manager.getApi()) as unknown as {
      rotateClientSecret(input: unknown): Promise<{ client_secret?: unknown }>;
    };
    const rotated = await api.rotateClientSecret({ body: { client_id: clientId }, headers: new Headers({ cookie }) });
    expect(typeof rotated.client_secret).toBe('string');
    const row = await stored(id);
    expect(row?.client_secret).not.toBe(`digest-rotate_${label(type)}`);
    expect(row?.type).toBe(type);
  });
});

describe('[#25053] a write that sends `type` is judged against web and native', () => {
  const insertRow = (tag: string, type: unknown) => ({
    id: `oauthc_25053_${tag}`,
    name: `inserted ${tag}`,
    client_id: `c25053-${tag}`,
    user_id: ownerId,
    redirect_uris: JSON.stringify(['https://app.example.com/callback']),
    token_endpoint_auth_method: 'client_secret_basic',
    type,
  });

  it.each(UNDECLARED)('insert with type %s: refused, nothing stored', async (type) => {
    const tag = `insert_${label(type)}`;
    await expectTypeRefused(() => engine.insert(CLIENTS, insertRow(tag, type), SYSTEM));
    expect(await stored(`oauthc_25053_${tag}`)).toBeUndefined();
  });

  it.each(UNDECLARED)('update to type %s: refused, the stored type unchanged', async (type) => {
    const { id } = await seed(`update_${label(type)}`, 'web');
    await expectTypeRefused(() => engine.update(CLIENTS, { id, type }, SYSTEM));
    expect((await stored(id))?.type).toBe('web');
  });

  it.each(['web', 'native'] as const)('insert and update with type %s: accepted and stored as written', async (type) => {
    const tag = `insert_${type}`;
    await engine.insert(CLIENTS, insertRow(tag, type), SYSTEM);
    expect((await stored(`oauthc_25053_${tag}`))?.type).toBe(type);
    const { id } = await seed(`update_${type}`, type === 'web' ? 'native' : 'web');
    await engine.update(CLIENTS, { id, type }, SYSTEM);
    expect((await stored(id))?.type).toBe(type);
  });

  it('a null type is a blank value: accepted on insert and on update', async () => {
    await engine.insert(CLIENTS, insertRow('insert_null', null), SYSTEM);
    // The declared default may fill the blank on insert; the value is never refused.
    expect(['web', null]).toContain((await stored('oauthc_25053_insert_null'))?.type ?? null);
    const { id } = await seed('update_null', 'native');
    await engine.update(CLIENTS, { id, type: null }, SYSTEM);
    expect((await stored(id))?.type ?? null).toBeNull();
  });
});

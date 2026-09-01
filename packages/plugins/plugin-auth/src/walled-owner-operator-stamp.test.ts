// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12751] The walled owner-verified stamp — maintainer ruling 2026-08-28
 * (cloud#1677, verbatim): 「运营方创建即视为已验证」.
 *
 * Three layers, matching the implementation's:
 *
 *  1. **The pure decision matrix** (`shouldStampOwnerVerifiedAtCreation`) —
 *     every bound of the contract as a direct call: walled family only,
 *     declared-owner match only (compared the way the platform-admin
 *     derivation compares), operator-provisioned creation only (operator
 *     class, or the bootstrap carve-out; provider and non-bootstrap
 *     self-serve NEVER).
 *  2. **The store probe** (`probeWalledOwnerAccountState`) over a REAL
 *     `ObjectQL` engine — the same backend the derivation reads, so the
 *     probe's answers are measured against real driver representations, not
 *     a fake's.
 *  3. **The wiring, end to end** — real better-auth pipeline over the real
 *     engine (the `audience-bootstrap-seam` harness shape): the declared
 *     owner's operator-provisioned row is BORN `email_verified`, and every
 *     "never" cell of the matrix stays unverified through the same pipeline.
 *     The verified read-back uses the shared [#11343] allow-list
 *     (`isEmailVerifiedUserRow`) — the predicate the derivation itself
 *     refuses on — so a green here IS "`resolve-authz-context.ts` §6b-config
 *     would resolve PLATFORM_ADMIN for this row", without booting
 *     plugin-security.
 *
 * ⚠️ The mechanism this file's prose used to name — the walled platform-admin
 * ELEVATION GATE — is RETIRED (#11663 leg L4): `bootstrapPlatformAdmin` writes
 * no grant row under a walled posture and elevates nobody, it reports.
 * Standing is derived PER REQUEST instead, and the implementation this file
 * covers says the same ([#11973] note in `walled-owner-operator-stamp.ts`:
 * "the invariant is enforced at the derivation site … rather than by an
 * elevation write; the stamp's value is unchanged"). One `it()` title below
 * still names the gate; correcting a title is an executable change, not a
 * comment fix, so it is left for the card that can price it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { isEmailVerifiedUserRow } from '@objectstack/types';
import { AuthManager } from './auth-manager.js';
import {
  isOperatorProvisionedCreation,
  shouldStampOwnerVerifiedAtCreation,
} from './walled-owner-operator-stamp.js';
import { probeWalledOwnerAccountState } from './walled-owner-verification-path.js';
import { inviteForAudienceGate } from './audience-gate-test-support';
import {
  SysUser,
  SysSession,
  SysAccount,
  SysVerification,
  SysOrganization,
  SysMember,
  SysInvitation,
  SysTeam,
  SysTeamMember,
} from '@objectstack/platform-objects';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-12751';
const PASSWORD = 'S3cure!Passw0rd-12751';
const OWNER = 'operator@corp.example';

// ── env stubbing — the decision reads posture + owner from the environment ──

const ENV_KEYS = [
  'OS_TENANCY_POSTURE',
  'OS_MULTI_ORG_ENABLED',
  'OS_PLATFORM_OWNER_EMAIL',
  'OS_SEED_ADMIN',
  'OS_SEED_ADMIN_EMAIL',
  'NODE_ENV',
] as const;
const SAVED: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) {
    SAVED[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

const walledWithOwner = (owner = OWNER, posture = 'isolated') => {
  process.env.OS_TENANCY_POSTURE = posture;
  process.env.OS_PLATFORM_OWNER_EMAIL = owner;
};

/**
 * [#13147] The comma-separated value and its second member.
 * `OS_PLATFORM_OWNER_EMAIL` takes one address OR a list (#11663 Choice 2B).
 * Before this card the stamp compared a candidate against the operator's WHOLE
 * raw value as one address, so under a list no member was ever stamped — the
 * account was born unverified, so the per-request derivation
 * (`resolve-authz-context.ts` §6b-config) resolved it non-admin and the walled
 * boot log reported it "registered, NOT verified", silently.
 */
const SECOND_OWNER = 'ops@corp.example';
const OWNER_LIST = `${OWNER}, ${SECOND_OWNER}`;

// ── the real-engine harness (the audience-bootstrap-seam shape) ─────────────

const AUTH_OBJECTS = [
  SysUser,
  SysSession,
  SysAccount,
  SysVerification,
  SysOrganization,
  SysMember,
  SysInvitation,
  SysTeam,
  SysTeamMember,
];

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    const e = engines.pop();
    try {
      await (e as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});

async function bootEngine(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }),
    true,
  );
  await engine.init();
  for (const object of AUTH_OBJECTS) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();
  return engine;
}

function makeManager(engine: ObjectQL, config: Record<string, unknown> = {}): AuthManager {
  return new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as never,
    ...config,
  } as never);
}

function post(manager: AuthManager, path: string, body: unknown, bearer?: string): Promise<Response> {
  return manager.handleRequest(
    new Request(`${AUTH}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: BASE,
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

async function signUp(manager: AuthManager, email: string): Promise<Response> {
  return post(manager, '/sign-up/email', { email, password: PASSWORD, name: email.split('@')[0] });
}

async function userRow(engine: ObjectQL, email: string): Promise<Record<string, unknown>> {
  const rows = (await engine.find(
    'sys_user',
    { where: { email: email.toLowerCase() }, limit: 2 },
    { context: { isSystem: true } } as never,
  )) as Record<string, unknown>[];
  expect(rows, `expected exactly one sys_user row for ${email}`).toHaveLength(1);
  return rows[0];
}

// ────────────────────────────────────────────────────────────────────────────
// 1. The pure decision matrix.
// ────────────────────────────────────────────────────────────────────────────

describe('#12751 — shouldStampOwnerVerifiedAtCreation, the contract as a matrix', () => {
  it('owner via OPERATOR class on a walled deployment ⇒ stamp', () => {
    walledWithOwner();
    expect(
      shouldStampOwnerVerifiedAtCreation({ email: OWNER, creationClass: 'operator', isBootstrap: false }),
    ).toBe(true);
  });

  it('owner via the BOOTSTRAP carve-out (first self-serve account) on a walled deployment ⇒ stamp', () => {
    walledWithOwner();
    expect(
      shouldStampOwnerVerifiedAtCreation({ email: OWNER, creationClass: 'self-serve', isBootstrap: true }),
    ).toBe(true);
  });

  it('owner via NON-bootstrap self-serve ⇒ NEVER — a self-registrant typing the owner address proves nothing', () => {
    walledWithOwner();
    expect(
      shouldStampOwnerVerifiedAtCreation({ email: OWNER, creationClass: 'self-serve', isBootstrap: false }),
    ).toBe(false);
  });

  it('owner via PROVIDER class ⇒ NEVER — the IdP asserts its own emailVerified at insert', () => {
    walledWithOwner();
    for (const isBootstrap of [true, false]) {
      expect(
        shouldStampOwnerVerifiedAtCreation({ email: OWNER, creationClass: 'provider', isBootstrap }),
      ).toBe(false);
    }
  });

  it('NON-owner via operator paths ⇒ never, on every class', () => {
    walledWithOwner();
    expect(
      shouldStampOwnerVerifiedAtCreation({
        email: 'stranger@corp.example',
        creationClass: 'operator',
        isBootstrap: false,
      }),
    ).toBe(false);
    expect(
      shouldStampOwnerVerifiedAtCreation({
        email: 'stranger@corp.example',
        creationClass: 'self-serve',
        isBootstrap: true,
      }),
    ).toBe(false);
  });

  it('UNWALLED postures ⇒ never — elevation there never demands a verified owner', () => {
    process.env.OS_TENANCY_POSTURE = 'single';
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER;
    expect(
      shouldStampOwnerVerifiedAtCreation({ email: OWNER, creationClass: 'operator', isBootstrap: false }),
    ).toBe(false);
    expect(
      shouldStampOwnerVerifiedAtCreation({ email: OWNER, creationClass: 'self-serve', isBootstrap: true }),
    ).toBe(false);
  });

  it('the whole walled FAMILY is covered — `group` too', () => {
    walledWithOwner(OWNER, 'group');
    expect(
      shouldStampOwnerVerifiedAtCreation({ email: OWNER, creationClass: 'self-serve', isBootstrap: true }),
    ).toBe(true);
  });

  it('owner UNDECLARED ⇒ never (that walled boot is refused elsewhere; off the boot path, no stamp)', () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    expect(
      shouldStampOwnerVerifiedAtCreation({ email: OWNER, creationClass: 'operator', isBootstrap: false }),
    ).toBe(false);
  });

  it('the email comparison MIRRORS the elevation gate: trimmed, case-insensitive, both sides', () => {
    // The env declaration arrives padded and cased however the operator typed
    // it; `resolvePlatformOwnerEmail` trims, the comparison lowercases — the
    // exact treatment `bootstrapPlatformAdmin` gives the same pair.
    walledWithOwner('  Operator@CORP.example  ');
    expect(
      shouldStampOwnerVerifiedAtCreation({
        email: 'operator@corp.example',
        creationClass: 'self-serve',
        isBootstrap: true,
      }),
    ).toBe(true);
    expect(
      shouldStampOwnerVerifiedAtCreation({
        email: ' OPERATOR@corp.example ',
        creationClass: 'operator',
        isBootstrap: false,
      }),
    ).toBe(true);
    // …and a DIFFERENT address does not fold into a match.
    expect(
      shouldStampOwnerVerifiedAtCreation({
        email: 'operator2@corp.example',
        creationClass: 'operator',
        isBootstrap: false,
      }),
    ).toBe(false);
  });

  it('isOperatorProvisionedCreation names the qualifying paths and nothing else', () => {
    expect(isOperatorProvisionedCreation('operator', false)).toBe(true);
    expect(isOperatorProvisionedCreation('self-serve', true)).toBe(true);
    expect(isOperatorProvisionedCreation('self-serve', false)).toBe(false);
    expect(isOperatorProvisionedCreation('provider', true)).toBe(false);
    expect(isOperatorProvisionedCreation('provider', false)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. The store probe, over the real engine.
// ────────────────────────────────────────────────────────────────────────────

describe('[#13147] shouldStampOwnerVerifiedAtCreation under a comma-separated OS_PLATFORM_OWNER_EMAIL', () => {
  const operator = (email: string | undefined) =>
    shouldStampOwnerVerifiedAtCreation({ email, creationClass: 'operator', isBootstrap: false });

  it('EVERY declared member is stamped, not just the first', () => {
    walledWithOwner(OWNER_LIST);
    expect(operator(OWNER)).toBe(true);
    expect(operator(SECOND_OWNER)).toBe(true);
  });

  it('per-entry case-insensitivity and trimming survive the list', () => {
    walledWithOwner(`  First.Op@Corp.EXAMPLE , ${SECOND_OWNER} `);
    expect(operator('first.op@corp.example')).toBe(true);
    expect(operator('  OPS@Corp.Example  ')).toBe(true);
  });

  it('⛔ a stranger is never stamped, and the raw list is not itself an address', () => {
    walledWithOwner(OWNER_LIST);
    expect(operator('stranger@corp.example')).toBe(false);
    expect(operator(OWNER_LIST)).toBe(false);
    expect(operator(undefined)).toBe(false);
    expect(operator('')).toBe(false);
  });

  it('⛔ a REFUSED list stamps nobody — the whole variable fails closed', () => {
    walledWithOwner(`${OWNER},not-an-email`);
    expect(operator(OWNER)).toBe(false);
  });

  it('the other bounds are untouched: unwalled and non-operator creations still never stamp', () => {
    walledWithOwner(OWNER_LIST, 'single');
    expect(operator(SECOND_OWNER)).toBe(false);
    walledWithOwner(OWNER_LIST);
    expect(
      shouldStampOwnerVerifiedAtCreation({
        email: SECOND_OWNER,
        creationClass: 'self-serve',
        isBootstrap: false,
      }),
    ).toBe(false);
    expect(
      shouldStampOwnerVerifiedAtCreation({
        email: SECOND_OWNER,
        creationClass: 'provider',
        isBootstrap: true,
      }),
    ).toBe(false);
  });
});

describe('#12751 — probeWalledOwnerAccountState over a real ObjectQL engine', () => {
  it('an empty store is `no-human-users`', async () => {
    walledWithOwner();
    const engine = await bootEngine();
    expect(await probeWalledOwnerAccountState(engine as never)).toBe('no-human-users');
  });

  it('a store whose owner account exists unverified / verified answers each by the shared #11343 allow-list', async () => {
    walledWithOwner();
    const engine = await bootEngine();
    const manager = makeManager(engine);
    expect((await signUp(manager, 'bystander@corp.example')).status).toBe(200);
    await inviteForAudienceGate(manager, OWNER);
    // Break the stamp's own lane on purpose: an INVITED self-serve owner
    // arrives unverified (pinned below), which is exactly the probe's
    // `owner-unverified` shape.
    expect((await signUp(manager, OWNER)).status).toBe(200);
    expect(await probeWalledOwnerAccountState(engine as never)).toBe('owner-unverified');

    // Verify it the way better-auth would (the sys_user UPDATE doorway) and
    // the probe follows.
    const row = await userRow(engine, OWNER);
    await engine.update(
      'sys_user',
      { id: row.id, email_verified: true } as never,
      { context: { isSystem: true } } as never,
    );
    expect(await probeWalledOwnerAccountState(engine as never)).toBe('owner-verified');
  });

  it('[#13147] a comma-separated list: the probe answers about the DECLARED SET, over the real engine', async () => {
    // Before this card the probe queried `where email = '<the whole raw list>'`,
    // matched no row, and answered `owner-absent` for a deployment whose
    // administrator was registered and verified — a boot warning that named a
    // dead end that did not exist.
    walledWithOwner(OWNER_LIST);
    const engine = await bootEngine();
    const manager = makeManager(engine);
    expect((await signUp(manager, 'bystander@corp.example')).status).toBe(200);
    expect(await probeWalledOwnerAccountState(engine as never)).toBe('owner-absent');

    // The SECOND declared member registers (invited ⇒ arrives unverified).
    await inviteForAudienceGate(manager, SECOND_OWNER);
    expect((await signUp(manager, SECOND_OWNER)).status).toBe(200);
    expect(await probeWalledOwnerAccountState(engine as never)).toBe('owner-unverified');

    // One verified member is all the derivation needs, so it is all the probe
    // reports — the standing surface's own outcomes, mirrored.
    const row = await userRow(engine, SECOND_OWNER);
    await engine.update(
      'sys_user',
      { id: row.id, email_verified: true } as never,
      { context: { isSystem: true } } as never,
    );
    expect(await probeWalledOwnerAccountState(engine as never)).toBe('owner-verified');
  });

  it('[#13147] a REFUSED list declares nobody ⇒ `unknown`, like an unset variable', async () => {
    walledWithOwner(`${OWNER},not-an-email`);
    const engine = await bootEngine();
    expect(await probeWalledOwnerAccountState(engine as never)).toBe('unknown');
  });

  it('a populated store with no owner account is `owner-absent`', async () => {
    walledWithOwner();
    const engine = await bootEngine();
    const manager = makeManager(engine);
    expect((await signUp(manager, 'bystander@corp.example')).status).toBe(200);
    expect(await probeWalledOwnerAccountState(engine as never)).toBe('owner-absent');
  });

  it('no engine / no declared owner ⇒ `unknown` — the loud fallback', async () => {
    walledWithOwner();
    expect(await probeWalledOwnerAccountState(undefined)).toBe('unknown');
    delete process.env.OS_PLATFORM_OWNER_EMAIL;
    const engine = await bootEngine();
    expect(await probeWalledOwnerAccountState(engine as never)).toBe('unknown');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. End to end: the real better-auth pipeline over the real engine.
// ────────────────────────────────────────────────────────────────────────────

describe('#12751 — the stamp lands through the REAL creation pipeline', () => {
  it('THE CONSUMER CASE: on a walled deployment the declared owner’s bootstrap first account is BORN verified', async () => {
    walledWithOwner();
    const engine = await bootEngine();
    const manager = makeManager(engine);

    const res = await signUp(manager, OWNER);
    expect(res.status, `owner bootstrap sign-up refused: ${await res.clone().text()}`).toBe(200);

    const row = await userRow(engine, OWNER);
    // Read back through the derivation's own predicate: a `true` here is
    // "§6b-config would resolve PLATFORM_ADMIN for this row", representation
    // included.
    expect(
      isEmailVerifiedUserRow(row),
      `owner row not verified at creation: email_verified=${JSON.stringify(row.email_verified)}`,
    ).toBe(true);
  });

  it('…and the seed’s own server-side lane (api.signUpEmail) lands the same way — the walled dev boot keeps working', async () => {
    // The dev-admin seed calls `api.signUpEmail` in-process and then applies
    // its own #11343 stamp. With #12751 the row is already BORN verified on a
    // walled boot (this lane), so the seed's later update is an idempotent
    // no-op — same terminal state, no behaviour change.
    process.env.NODE_ENV = 'development';
    walledWithOwner('admin@objectos.ai');
    const engine = await bootEngine();
    const manager = makeManager(engine);
    const api = (await manager.getApi()) as unknown as {
      signUpEmail(input: { body: Record<string, unknown> }): Promise<unknown>;
    };
    await api.signUpEmail({
      body: { email: 'admin@objectos.ai', password: PASSWORD, name: 'Dev Admin' },
    });
    expect(isEmailVerifiedUserRow(await userRow(engine, 'admin@objectos.ai'))).toBe(true);
  });

  it('a NON-owner bootstrap first account is NOT stamped', async () => {
    walledWithOwner();
    const engine = await bootEngine();
    const manager = makeManager(engine);
    expect((await signUp(manager, 'bystander@corp.example')).status).toBe(200);
    expect(isEmailVerifiedUserRow(await userRow(engine, 'bystander@corp.example'))).toBe(false);
  });

  it('on an UNWALLED posture the owner’s first account is NOT stamped — dev-boot/single behaviour unchanged', async () => {
    process.env.OS_TENANCY_POSTURE = 'single';
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER;
    const engine = await bootEngine();
    const manager = makeManager(engine);
    expect((await signUp(manager, OWNER)).status).toBe(200);
    expect(isEmailVerifiedUserRow(await userRow(engine, OWNER))).toBe(false);
  });

  it('an INVITED self-serve registration typing the owner address is NOT stamped — self-registration never qualifies', async () => {
    walledWithOwner();
    const engine = await bootEngine();
    const manager = makeManager(engine);
    expect((await signUp(manager, 'bystander@corp.example')).status).toBe(200); // spends bootstrap
    await inviteForAudienceGate(manager, OWNER);
    expect((await signUp(manager, OWNER)).status).toBe(200); // invitation carve-out admits it
    expect(isEmailVerifiedUserRow(await userRow(engine, OWNER))).toBe(false);
  });

  it('a later email UPDATE to the owner address inherits NOTHING', async () => {
    walledWithOwner();
    const engine = await bootEngine();
    const manager = makeManager(engine);
    expect((await signUp(manager, 'bystander@corp.example')).status).toBe(200);
    const before = await userRow(engine, 'bystander@corp.example');
    expect(isEmailVerifiedUserRow(before)).toBe(false);

    // The rename lane the contract names: the account MOVES ONTO the declared
    // owner address after creation. The stamp is consumed at `user.create`
    // only, so nothing fires here.
    await engine.update(
      'sys_user',
      { id: before.id, email: OWNER } as never,
      { context: { isSystem: true } } as never,
    );
    expect(isEmailVerifiedUserRow(await userRow(engine, OWNER))).toBe(false);
  });

  it('OPERATOR admin-create of the declared owner is BORN verified; of anyone else, NOT', async () => {
    walledWithOwner();
    const engine = await bootEngine();
    const manager = makeManager(engine, { plugins: { admin: true } });

    // Founder (non-owner) takes the bootstrap slot, then becomes a vendor
    // admin (`role: 'admin'` — the better-auth admin plugin's own gate).
    expect((await signUp(manager, 'founder@corp.example')).status).toBe(200);
    const founder = await userRow(engine, 'founder@corp.example');
    await engine.update(
      'sys_user',
      { id: founder.id, role: 'admin' } as never,
      { context: { isSystem: true } } as never,
    );
    const signIn = await post(manager, '/sign-in/email', {
      email: 'founder@corp.example',
      password: PASSWORD,
    });
    expect(signIn.status, `founder sign-in failed: ${await signIn.clone().text()}`).toBe(200);
    const bearer = signIn.headers.get('set-auth-token');
    expect(bearer, 'sign-in must mint a bearer or the admin legs prove nothing').toBeTruthy();

    // The operator act: better-auth admin create-user, `{ method: 'admin' }`
    // at the validateUserInfo seam — the operator class.
    const createOwner = await post(
      manager,
      '/admin/create-user',
      { email: OWNER, password: PASSWORD, name: 'Operator' },
      bearer!,
    );
    expect(createOwner.status, `admin create-user refused: ${await createOwner.clone().text()}`).toBe(200);
    expect(isEmailVerifiedUserRow(await userRow(engine, OWNER))).toBe(true);

    // Control: the same operator act for a NON-owner address stamps nothing.
    const createOther = await post(
      manager,
      '/admin/create-user',
      { email: 'colleague@corp.example', password: PASSWORD, name: 'Colleague' },
      bearer!,
    );
    expect(createOther.status, `admin create-user refused: ${await createOther.clone().text()}`).toBe(200);
    expect(isEmailVerifiedUserRow(await userRow(engine, 'colleague@corp.example'))).toBe(false);
  });
});

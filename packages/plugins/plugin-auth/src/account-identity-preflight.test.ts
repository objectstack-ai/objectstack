// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17440] The preflight that guards the retirement of `sys_account.issuer`,
 * and the answer to the one case that column still discriminated.
 *
 * ## Why the collision fixture registers an INDEX-LESS `sys_account`
 *
 * This is the load-bearing decision in the file, and it is not a convenience.
 *
 * `sys_account` has declared `{ fields: ['provider_id', 'account_id'], unique:
 * true }` since the object was created. Where that index is PHYSICALLY present
 * the collision class cannot be inserted at all — which the `PREMISE` case
 * below proves by trying, against the REAL object, and watching the driver
 * refuse.
 *
 * So the only population that can hold the class is a deployment carrying the
 * declaration without the constraint. That population is real and reachable:
 * `syncDeclaredIndexes` logs a plain UNIQUE whose CREATE fails on existing
 * duplicates onto the durability channel and lets the boot continue
 * (#14902 / #15479), deliberately, so one dirty table cannot take a deployment
 * down. `SYS_ACCOUNT_NO_UNIQUE` below is that deployment, spelled as a fixture
 * — the same shape with the unique index absent.
 *
 * ⇒ The two cases are a pair. The premise case says "where the index exists,
 * this class cannot arrive"; the refusal cases say "where it does not, the
 * preflight finds it and stops". Either alone would be misleading.
 *
 * ## What "watched refusing" means here
 *
 * Every refusal case asserts the ADR-0112 envelope (`code` + `status`) and the
 * substance of the message, never a bare `toThrow()`. A bare throw assertion
 * would pass on an unrelated `TypeError` from a fixture that never reached the
 * probe — which is exactly how a preflight gets believed without ever running.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  probeAccountIdentityCollisions,
  assertNoAccountIdentityCollisions,
  formatAccountIdentityPreflightReport,
  refuseIssuerRepointWithLiveBindings,
  AccountIdentityPreflightRefusal,
  SYS_ACCOUNT_OBJECT,
} from './account-identity-preflight.js';
import { authIdentityObjects } from './manifest.js';

const SYSTEM = { context: { isSystem: true } } as never;

/**
 * `sys_account` as a deployment whose declared `(provider_id, account_id)`
 * UNIQUE was never physically created — the #14902 / #15479 population. Only
 * the columns the probe reads are spelled.
 */
const SYS_ACCOUNT_NO_UNIQUE = {
  name: 'sys_account',
  label: 'Account',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    provider_id: { name: 'provider_id', type: 'text' as const },
    account_id: { name: 'account_id', type: 'text' as const },
    issuer: { name: 'issuer', type: 'text' as const },
    user_id: { name: 'user_id', type: 'text' as const },
  },
};

/** `sys_sso_provider`, index-free, for the re-point guard's fixtures. */
const SYS_SSO_PROVIDER_FIXTURE = {
  name: 'sys_sso_provider',
  label: 'SSO Provider',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    provider_id: { name: 'provider_id', type: 'text' as const },
    issuer: { name: 'issuer', type: 'text' as const },
  },
};

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    const engine = engines.pop();
    try {
      await (engine as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});

async function bootEngine(objects: unknown[]): Promise<ObjectQL> {
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
  for (const object of objects) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();
  return engine;
}

/** The index-less deployment: the only one that can hold the collision class. */
const bootDirtyCapable = () =>
  bootEngine([SYS_ACCOUNT_NO_UNIQUE, SYS_SSO_PROVIDER_FIXTURE]);

const insertAccount = (
  engine: ObjectQL,
  row: { id: string; provider_id: string; account_id: string; issuer?: string | null; user_id: string },
) => engine.insert(SYS_ACCOUNT_OBJECT, row as never, SYSTEM);

describe('#17440 PREMISE — where the declared unique EXISTS, the class cannot arrive', () => {
  it('the retired column is gone from the real sys_account', async () => {
    const engine = await bootEngine(authIdentityObjects);
    // The retirement itself, pinned at the object: a write naming `issuer` is
    // refused as an undeclared field. This is what makes the index-less
    // fixture above a MODEL of an existing deployment rather than a copy of
    // the current object.
    await expect(
      engine.insert(
        SYS_ACCOUNT_OBJECT,
        { id: 'acc_0', provider_id: 'okta', account_id: 'sub-0', issuer: 'https://a.example', user_id: 'usr_a' } as never,
        SYSTEM,
      ),
    ).rejects.toThrow(/Unknown field 'issuer' on object 'sys_account'/);
  });

  it('the real sys_account refuses the second row of a collision', async () => {
    // The real object, unique index and all — the platform's own declaration,
    // which has carried (provider_id, account_id) UNIQUE since the object was
    // created and therefore long before `issuer` ever arrived.
    const engine = await bootEngine(authIdentityObjects);
    await engine.insert(
      SYS_ACCOUNT_OBJECT,
      { id: 'acc_1', provider_id: 'okta', account_id: 'sub-1', user_id: 'usr_a' } as never,
      SYSTEM,
    );

    // Same (provider_id, account_id) — the pair that WAS separable by issuer.
    await expect(
      engine.insert(
        SYS_ACCOUNT_OBJECT,
        { id: 'acc_2', provider_id: 'okta', account_id: 'sub-1', user_id: 'usr_b' } as never,
        SYSTEM,
      ),
    ).rejects.toThrow();

    // The control on that rejection: a DIFFERENT account_id under the same
    // provider inserts fine, so the refusal above is the unique index and not
    // a broken fixture.
    await expect(
      engine.insert(
        SYS_ACCOUNT_OBJECT,
        { id: 'acc_3', provider_id: 'okta', account_id: 'sub-2', user_id: 'usr_b' } as never,
        SYSTEM,
      ),
    ).resolves.toBeTruthy();
  });
});

describe('#17440 the preflight REFUSES on the collision class', () => {
  it('refuses, naming the rows, when one key is held by two rows differing only in issuer', async () => {
    const engine = await bootDirtyCapable();
    await insertAccount(engine, { id: 'acc_1', provider_id: 'okta', account_id: 'sub-1', issuer: 'https://old.example', user_id: 'usr_alice' });
    await insertAccount(engine, { id: 'acc_2', provider_id: 'okta', account_id: 'sub-1', issuer: 'https://new.example', user_id: 'usr_bob' });
    await insertAccount(engine, { id: 'acc_3', provider_id: 'credential', account_id: 'usr_alice', issuer: 'local:credential', user_id: 'usr_alice' });

    const report = await probeAccountIdentityCollisions(engine as never);

    expect(report.scanned, 'every row was read').toBe(3);
    expect(report.ok, 'the database is NOT clean').toBe(false);
    expect(report.collisions).toHaveLength(1);
    expect(report.collisions[0]).toMatchObject({
      providerId: 'okta',
      accountId: 'sub-1',
      issuers: ['https://new.example', 'https://old.example'],
      rowIds: ['acc_1', 'acc_2'],
      userIds: ['usr_alice', 'usr_bob'],
      crossUser: true,
    });
    expect(report.crossUser, 'the collision spans two people').toBe(1);

    // The refusal itself — watched, with its envelope.
    let refusal: AccountIdentityPreflightRefusal | undefined;
    try {
      assertNoAccountIdentityCollisions(report);
    } catch (e) {
      refusal = e as AccountIdentityPreflightRefusal;
    }
    expect(refusal, 'assertNoAccountIdentityCollisions REFUSED').toBeInstanceOf(
      AccountIdentityPreflightRefusal,
    );
    expect(refusal!.code).toBe('RESOURCE_CONFLICT');
    expect(refusal!.status).toBe(409);
    expect(refusal!.message).toContain('held by');
    expect(refusal!.message, 'the cross-user danger is named, not just counted').toContain(
      'sign in and resolve to the other one',
    );
    expect(refusal!.message, 'nothing is repaired for the operator').toContain(
      'Nothing is merged or deleted for you',
    );

    // The operator-facing report carries the identifying detail.
    const text = formatAccountIdentityPreflightReport(report);
    expect(text).toContain('okta / sub-1');
    expect(text).toContain('acc_1, acc_2');
    expect(text).toContain('CROSS-USER');
  });

  it('flags a same-user collision WITHOUT the cross-user marker', async () => {
    const engine = await bootDirtyCapable();
    await insertAccount(engine, { id: 'acc_1', provider_id: 'okta', account_id: 'sub-1', issuer: 'https://old.example', user_id: 'usr_alice' });
    await insertAccount(engine, { id: 'acc_2', provider_id: 'okta', account_id: 'sub-1', issuer: 'https://new.example', user_id: 'usr_alice' });

    const report = await probeAccountIdentityCollisions(engine as never);
    expect(report.ok).toBe(false);
    expect(report.collisions).toHaveLength(1);
    expect(report.collisions[0]!.crossUser, 'one person, two rows — dedupable, not a takeover').toBe(false);
    expect(report.crossUser).toBe(0);
    expect(() => assertNoAccountIdentityCollisions(report)).toThrow(AccountIdentityPreflightRefusal);
  });

  /**
   * The control on every zero above. Without it "refuses" could mean "refuses
   * whatever it is handed", and a preflight that always refuses is as useless
   * as one that never does.
   */
  it('CONTROL — a clean table passes, and the same rows minus the duplicate stop being a finding', async () => {
    const engine = await bootDirtyCapable();
    await insertAccount(engine, { id: 'acc_1', provider_id: 'okta', account_id: 'sub-1', issuer: 'https://old.example', user_id: 'usr_alice' });
    await insertAccount(engine, { id: 'acc_2', provider_id: 'okta', account_id: 'sub-2', issuer: 'https://new.example', user_id: 'usr_bob' });
    await insertAccount(engine, { id: 'acc_3', provider_id: 'credential', account_id: 'usr_alice', issuer: null, user_id: 'usr_alice' });

    const report = await probeAccountIdentityCollisions(engine as never);
    expect(report.scanned).toBe(3);
    expect(report.keys, 'three distinct keys').toBe(3);
    expect(report.ok).toBe(true);
    expect(report.collisions).toEqual([]);
    expect(() => assertNoAccountIdentityCollisions(report)).not.toThrow();
    expect(formatAccountIdentityPreflightReport(report)).toContain('safe to drop');
  });

  it('CONTROL — an empty table is clean, and says how much it read', async () => {
    const engine = await bootDirtyCapable();
    const report = await probeAccountIdentityCollisions(engine as never);
    expect(report).toMatchObject({ scanned: 0, keys: 0, ok: true, crossUser: 0 });
  });
});

describe('#17440 the preflight refuses what it CANNOT read — an unread table is not a clean one', () => {
  it('a read that throws refuses instead of reporting zero rows', async () => {
    const broken = {
      find: async () => {
        throw new Error('connection reset by peer');
      },
    };
    let refusal: AccountIdentityPreflightRefusal | undefined;
    try {
      await probeAccountIdentityCollisions(broken as never);
    } catch (e) {
      refusal = e as AccountIdentityPreflightRefusal;
    }
    expect(refusal).toBeInstanceOf(AccountIdentityPreflightRefusal);
    expect(refusal!.code).toBe('RESOURCE_CONFLICT');
    expect(refusal!.status).toBe(409);
    expect(refusal!.message).toContain('Cannot enumerate sys_account');
    expect(refusal!.message, 'the underlying cause survives').toContain('connection reset by peer');
    expect(refusal!.message).toContain('Refusing rather than reporting an unread table as clean');
  });

  it('a walk stopped by its row cap refuses instead of reporting a partial scan as clean', async () => {
    const engine = await bootDirtyCapable();
    for (let i = 0; i < 5; i++) {
      await insertAccount(engine, { id: `acc_${i}`, provider_id: 'credential', account_id: `u${i}`, issuer: 'local:credential', user_id: `u${i}` });
    }

    // Cap below the row count: the tail is unread, and the tail is exactly
    // where the class could be hiding.
    let refusal: AccountIdentityPreflightRefusal | undefined;
    try {
      await probeAccountIdentityCollisions(engine as never, { max: 2 });
    } catch (e) {
      refusal = e as AccountIdentityPreflightRefusal;
    }
    expect(refusal).toBeInstanceOf(AccountIdentityPreflightRefusal);
    expect(refusal!.message).toContain('without reaching the end of the table');
    expect(refusal!.message).toContain('--max-records');

    // CONTROL — the same table under a cap that DOES reach the end is clean.
    // Without this the refusal above could be "any cap refuses".
    const ok = await probeAccountIdentityCollisions(engine as never, { max: 50 });
    expect(ok).toMatchObject({ scanned: 5, ok: true });
  });

  it('an engine that answers a non-array refuses rather than reading it as empty', async () => {
    const enveloped = { find: async () => ({ records: [] }) };
    await expect(probeAccountIdentityCollisions(enveloped as never)).rejects.toThrow(
      /not an array/,
    );
  });

  it('no engine at all refuses', async () => {
    await expect(probeAccountIdentityCollisions(undefined as never)).rejects.toThrow(
      /no readable ObjectQL engine/,
    );
  });
});

/**
 * ## The re-pointed-provider answer, pinned
 *
 * **A `provider_id` re-pointed at a different IdP must have its account
 * bindings rebuilt. No key separates them, and after the column drop nothing
 * can.**
 *
 * The first case pins WHY (the key genuinely cannot tell the two apart); the
 * rest pin the enforcement that follows from it.
 */
describe('#17440 re-pointed provider — the key cannot separate old bindings from new', () => {
  it('THE ANSWER: two rows under one provider_id differing only in issuer are ONE key', async () => {
    const engine = await bootDirtyCapable();
    // The shape a re-point leaves behind: `okta` pointed at IdP-A when Alice
    // linked, at IdP-B when Bob did, and IdP-B minted a `sub` IdP-A had
    // already issued to somebody else.
    await insertAccount(engine, { id: 'acc_alice', provider_id: 'okta', account_id: 'sub-7', issuer: 'https://idp-a.example', user_id: 'usr_alice' });
    await insertAccount(engine, { id: 'acc_bob', provider_id: 'okta', account_id: 'sub-7', issuer: 'https://idp-b.example', user_id: 'usr_bob' });

    const report = await probeAccountIdentityCollisions(engine as never);

    // ONE key, TWO rows, TWO issuers, TWO people. The retired column is the
    // only thing that ever told them apart, and it is the column being dropped.
    expect(report.keys, 'the two rows share a single (provider_id, account_id)').toBe(1);
    expect(report.collisions).toHaveLength(1);
    expect(report.collisions[0]!.issuers).toEqual(['https://idp-a.example', 'https://idp-b.example']);
    expect(report.collisions[0]!.crossUser, 'a sign-in here resolves to the wrong person').toBe(true);

    // ⇒ so the migration refuses, and the remedy is a rebuild of the bindings
    // rather than a key that separates them.
    expect(() => assertNoAccountIdentityCollisions(report)).toThrow(
      /delete the rest so a fresh sign-in re-links/,
    );
  });

  it('the guard REFUSES an issuer change while accounts are still bound to that provider', async () => {
    const engine = await bootDirtyCapable();
    await engine.insert(
      'sys_sso_provider',
      { id: 'sso_1', provider_id: 'okta', issuer: 'https://idp-a.example' } as never,
      SYSTEM,
    );
    await insertAccount(engine, { id: 'acc_alice', provider_id: 'okta', account_id: 'sub-7', issuer: 'https://idp-a.example', user_id: 'usr_alice' });

    let refusal: AccountIdentityPreflightRefusal | undefined;
    try {
      await refuseIssuerRepointWithLiveBindings(
        engine as never,
        'sys_sso_provider',
        { id: 'sso_1', provider_id: 'okta', issuer: 'https://idp-a.example' },
        { issuer: 'https://idp-b.example' },
      );
    } catch (e) {
      refusal = e as AccountIdentityPreflightRefusal;
    }
    expect(refusal, 'the re-point was REFUSED').toBeInstanceOf(AccountIdentityPreflightRefusal);
    expect(refusal!.code).toBe('RESOURCE_CONFLICT');
    expect(refusal!.status).toBe(409);
    expect(refusal!.message).toContain('cannot be re-pointed');
    expect(refusal!.message, 'the bound rows are named').toContain('acc_alice');
    expect(refusal!.message, 'the remedy is the rebuild, not a key').toContain(
      'Delete this provider\'s account bindings first',
    );
  });

  it('CONTROL — the same re-point is ALLOWED once nothing is bound to that provider', async () => {
    const engine = await bootDirtyCapable();
    await engine.insert(
      'sys_sso_provider',
      { id: 'sso_1', provider_id: 'okta', issuer: 'https://idp-a.example' } as never,
      SYSTEM,
    );
    // A binding under a DIFFERENT provider must not hold `okta` hostage.
    await insertAccount(engine, { id: 'acc_other', provider_id: 'entra', account_id: 'sub-9', issuer: 'https://idp-c.example', user_id: 'usr_carol' });

    await expect(
      refuseIssuerRepointWithLiveBindings(
        engine as never,
        'sys_sso_provider',
        { id: 'sso_1', provider_id: 'okta', issuer: 'https://idp-a.example' },
        { issuer: 'https://idp-b.example' },
      ),
    ).resolves.toBeUndefined();
  });

  it('CONTROL — a write that does not MOVE the issuer is not a re-point', async () => {
    const engine = await bootDirtyCapable();
    await insertAccount(engine, { id: 'acc_alice', provider_id: 'okta', account_id: 'sub-7', issuer: 'https://idp-a.example', user_id: 'usr_alice' });
    const existing = { id: 'sso_1', provider_id: 'okta', issuer: 'https://idp-a.example' };

    // Same value rewritten.
    await expect(
      refuseIssuerRepointWithLiveBindings(engine as never, 'sys_sso_provider', existing, {
        issuer: 'https://idp-a.example',
      }),
    ).resolves.toBeUndefined();
    // A patch that never mentions `issuer` at all.
    await expect(
      refuseIssuerRepointWithLiveBindings(engine as never, 'sys_sso_provider', existing, {
        domain: 'acme.com',
      }),
    ).resolves.toBeUndefined();
    // A different object entirely.
    await expect(
      refuseIssuerRepointWithLiveBindings(engine as never, 'sys_user', existing, {
        issuer: 'https://idp-b.example',
      }),
    ).resolves.toBeUndefined();
  });

  it('the guard refuses when it cannot READ the bindings — never re-points blind', async () => {
    const broken = {
      find: async () => {
        throw new Error('table is locked');
      },
    };
    let refusal: AccountIdentityPreflightRefusal | undefined;
    try {
      await refuseIssuerRepointWithLiveBindings(
        broken as never,
        'sys_sso_provider',
        { id: 'sso_1', provider_id: 'okta', issuer: 'https://idp-a.example' },
        { issuer: 'https://idp-b.example' },
      );
    } catch (e) {
      refusal = e as AccountIdentityPreflightRefusal;
    }
    expect(refusal).toBeInstanceOf(AccountIdentityPreflightRefusal);
    expect(refusal!.status).toBe(409);
    expect(refusal!.message).toContain('Cannot check the account bindings');
    expect(refusal!.message).toContain('table is locked');
  });
});

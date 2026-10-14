// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23474] An `email`-audience share link's refusal must do the SAME WORK
 * whatever email and password are presented.
 *
 * ## The property this pins
 *
 * PR #23471 (#23372) made every refusal of an `email`-audience link
 * byte-identical on both mounts, so no caller can read allowlist membership
 * out of the ANSWER. This pins the other half: the refusal's WORK does not
 * depend on the email presented either, since work that differs on whether an
 * address is on the list is a channel whatever the answer bytes are.
 *
 * Timing is flaky in CI, so the work is pinned deterministically rather than
 * the clock: for an `email`+password link, the work is counted per request and
 * must be equal for an off-list email and an allowlisted one, whether a wrong
 * password or no password is presented.
 *
 * ## What is real here
 *
 * One real `ObjectQL` on `@objectstack/driver-sql` + better-sqlite3 with the
 * shipped `sys_share_link` definition (whose `password_hash` is `internal`, so
 * the hash is recovered through `resolveInternalField` — the call this counts).
 * The password verifier is the production `verifyShareLinkPassword`, wrapped to
 * count. Both resolve mounts call this one `resolveToken`, so the cost lives
 * here, where one pin covers both.
 *
 * The controls stay green: an allowlisted email with the correct password still
 * serves the record, and the refusals stay the one generic `null`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ShareLinkService } from './share-link-service.js';
import { SysShareLink } from './objects/sys-share-link.object.js';
import { verifyShareLinkPassword } from './share-link-password.js';

const OBJECT = 'refusal_cost_doc';
const RECORD = 'doc_1';
const PASSWORD = 'correct horse 23474';
const WRONG = 'not the password 23474';
const ALLOWLISTED = 'recipient-23474@example.test';
const OFFLIST = 'offlist-23474@example.test';

const TARGET = {
  name: OBJECT,
  label: 'Refusal Cost Doc',
  publicSharing: { enabled: true, allowedAudiences: ['public', 'signed_in', 'email'], allowedPermissions: ['view'] },
  fields: {
    id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' },
  },
};

let engine: ObjectQL;
let svc: ShareLinkService;
let tokenPw = '';
let hashReads = 0;
let verifyCalls = 0;

/** Run one resolve and return how many hash reads / verifies it performed. */
async function cost(opts: { email?: string; password?: string }): Promise<{
  result: unknown;
  hashReads: number;
  verifyCalls: number;
}> {
  hashReads = 0;
  verifyCalls = 0;
  const result = await svc.resolveToken(tokenPw, {
    recipientEmail: opts.email,
    providedPassword: opts.password,
  });
  return { result, hashReads, verifyCalls };
}

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any,
    true,
  );
  await engine.init();
  for (const o of [SysShareLink, TARGET]) engine.registry.registerObject(o as any, '@objectstack/plugin-sharing-test');
  await engine.syncSchemas();
  await engine.insert(OBJECT, { id: RECORD, title: 'Shared doc' }, { context: { isSystem: true } } as any);

  // Count the privileged hash read — the `password_hash` dereference the
  // internal-column strip forces through the engine's accessor.
  const realResolve = (engine as any).resolveInternalField.bind(engine);
  (engine as any).resolveInternalField = async (object: string, ids: readonly string[], field: string) => {
    if (object === 'sys_share_link' && field === 'password_hash') hashReads++;
    return realResolve(object, ids, field);
  };

  // Count the password verify, wrapping the real verifier so behaviour is intact.
  svc = new ShareLinkService({
    engine: engine as any,
    verifyPassword: (plain, hash) => {
      verifyCalls++;
      return verifyShareLinkPassword(plain, hash);
    },
  });
  const creator = { isSystem: true, userId: 'usr_creator' } as any;
  tokenPw = (
    await svc.createLink(
      { object: OBJECT, recordId: RECORD, audience: 'email', password: PASSWORD, emailAllowlist: [ALLOWLISTED] },
      creator,
    )
  ).token;
}, 60_000);

afterAll(async () => {
  try { await engine?.destroy(); } catch { /* noop */ }
});

describe('[#23474] email-audience refusal cost is input-independent', () => {
  it('a wrong password: off-list and allowlisted read the hash and verify equally', async () => {
    const offList = await cost({ email: OFFLIST, password: WRONG });
    const allowlisted = await cost({ email: ALLOWLISTED, password: WRONG });
    // Both refuse (the generic null).
    expect(offList.result).toBeNull();
    expect(allowlisted.result).toBeNull();
    // The membership channel: equal work either way.
    expect(allowlisted.hashReads, 'hash reads (wrong password)').toBe(offList.hashReads);
    expect(allowlisted.verifyCalls, 'verify calls (wrong password)').toBe(offList.verifyCalls);
    // And it is actual work, not equal-at-zero.
    expect(offList.hashReads).toBeGreaterThan(0);
    expect(offList.verifyCalls).toBeGreaterThan(0);
  });

  it('no password: off-list and allowlisted read the hash equally (and neither verifies)', async () => {
    const offList = await cost({ email: OFFLIST });
    const allowlisted = await cost({ email: ALLOWLISTED });
    expect(offList.result).toBeNull();
    expect(allowlisted.result).toBeNull();
    // The hash read is equal too.
    expect(allowlisted.hashReads, 'hash reads (no password)').toBe(offList.hashReads);
    expect(offList.hashReads).toBeGreaterThan(0);
    // No password presented ⇒ no verify on either (a caller learns only about
    // its own input, identical for every address).
    expect(allowlisted.verifyCalls, 'verify calls (no password)').toBe(offList.verifyCalls);
    expect(offList.verifyCalls).toBe(0);
  });

  it('control: an allowlisted email with the correct password still serves the record', async () => {
    const served = await cost({ email: ALLOWLISTED, password: PASSWORD });
    expect(served.result).not.toBeNull();
    expect((served.result as any)?.link?.record_id).toBe(RECORD);
    expect(served.hashReads).toBeGreaterThan(0);
    expect(served.verifyCalls).toBeGreaterThan(0);
  });
});

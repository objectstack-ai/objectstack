// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A time-bounded permission-set assignment, end to end (ADR-0091 D1/D2): the
// window on a `sys_user_permission_set` row decides a user's REAL data access,
// at every evaluation, with no job anywhere.
//
// Booted on the showcase with its own default profile, the CLI wiring. A plain
// member reads `showcase_invoice` only through a grant: the showcase's
// `showcase_member_default` opens no read on it and `showcase_auditor` does
// (`examples/app-showcase/access-matrix.json`). So `GET /data/showcase_invoice`
// answers 200 exactly when the auditor assignment resolves, and the four window
// states are read off that one door:
//
//   no window                       → 200 (the control: an ordinary grant)
//   valid_from in the future        → 403
//   inside [valid_from, valid_until) → 200
//   valid_until in the past         → 403
//
// "At the next evaluation" is measured twice, with the clock and with a write:
//
//   - with NO write at the boundary. A grant whose valid_until falls a few
//     seconds ahead stops reading, and one whose valid_from falls there starts,
//     across one real wait — with the cross-request grants cache ON
//     (`OS_AUTHZ_GRANTS_CACHE_TTL_MS`, an hour), and the cache shown serving
//     before the boundary. A cached answer does not outlive the window: the
//     entry expires at the earliest window bound, not at its TTL.
//   - with an administrator's edit. A PATCH of `valid_until` on the assignment
//     row through the data door — what the record form submits — lands, and
//     the member's next request is refused.
//
// The declaring surface refuses a window whose end is not after its start, on
// this door too (400 VALIDATION_FAILED), and the boot ships no stored row with
// such a window.
//
// `@objectstack/plugin-security` and `@objectstack/core` resolve through their
// BUILT output here (ledgered pairs in `scripts/check-test-source-alias.mjs`),
// so a verdict on a change to either is a verdict on its last build.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { assertArmed, armedWhen } from './armed.js';

const SYS = { isSystem: true } as const;
const GRANTS = 'sys_user_permission_set';
const SET = 'showcase_auditor';
const DOOR = '/data/showcase_invoice';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const CACHE_TTL_ENV = 'OS_AUTHZ_GRANTS_CACHE_TTL_MS';

const iso = (ms: number) => new Date(ms).toISOString();
const sleepUntil = async (ms: number) => {
  for (let left = ms - Date.now(); left > 0; left = ms - Date.now()) {
    await new Promise((r) => setTimeout(r, Math.min(left, 250)));
  }
};

describe('a permission-set assignment grants only inside its validity window (ADR-0091 D1/D2)', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string;
  let setId: string;
  const tok: Record<string, string> = {};
  const uid: Record<string, string> = {};

  const sign = async (who: string) => {
    const email = `vwin-${who}@verify.test`;
    tok[who] = await stack.signUp(email);
    const u = await ql.findOne('sys_user', { where: { email }, context: SYS });
    uid[who] = String(u?.id ?? '');
    expect(uid[who], `${who} signed up`).toBeTruthy();
  };
  const grant = async (who: string, window: { valid_from?: string; valid_until?: string } = {}) => {
    await ql.insert(GRANTS, { user_id: uid[who], permission_set_id: setId, ...window }, { context: SYS });
  };
  const door = async (who: string) => (await stack.apiAs(tok[who], 'GET', `${DOOR}?$top=1`)).status;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    adminTok = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');

    const set = await ql.findOne('sys_permission_set', { where: { name: SET }, context: SYS });
    expect(set?.id, `the showcase seeded ${SET}`).toBeTruthy();
    setId = String(set.id);

    for (const who of ['bare', 'open', 'before', 'inside', 'after', 'edited', 'falls', 'rises']) await sign(who);
    const now = Date.now();
    await grant('open');
    await grant('before', { valid_from: iso(now + DAY) });
    await grant('inside', { valid_from: iso(now - DAY), valid_until: iso(now + DAY) });
    await grant('after', { valid_until: iso(now - HOUR) });
    await grant('edited');

    await assertArmed([
      armedWhen({
        control: `${DOOR} is opened by the ${SET} assignment and by nothing else a plain member holds`,
        disarmedBy:
          'a member who reads the door with no grant at all (or one who cannot read it even with an unbounded grant) '
          + 'would make every refusal below a statement about the profile, not about the window',
        observe: async () => ({ bare: await door('bare'), open: await door('open') }),
        armed: (o) => o.bare === 403 && o.open === 200,
      }),
    ]);
  }, 180_000);

  afterAll(async () => {
    delete process.env[CACHE_TTL_ENV];
    vi.restoreAllMocks();
    await stack?.stop();
  });

  it('an assignment with no window grants (the control)', async () => {
    expect(await door('open')).toBe(200);
  });

  it('an assignment before its valid_from grants nothing', async () => {
    expect(await door('before')).toBe(403);
  });

  it('an assignment inside [valid_from, valid_until) grants', async () => {
    expect(await door('inside')).toBe(200);
  });

  it('an assignment at or after its valid_until grants nothing', async () => {
    expect(await door('after')).toBe(403);
  });

  it('an administrator sets valid_until by editing the assignment row, and the next request is refused', async () => {
    expect(await door('edited'), 'the grant reads before the edit').toBe(200);
    const row = await ql.findOne(GRANTS, { where: { user_id: uid.edited }, context: SYS });
    const patch = await stack.apiAs(adminTok, 'PATCH', `/data/${GRANTS}/${row.id}`, {
      valid_until: iso(Date.now() - 1000),
    });
    expect(patch.status, await patch.clone().text()).toBe(200);
    expect(await door('edited')).toBe(403);
  });

  it('with the grants cache on, no cached answer outlives a window bound — with no write at the bound', async () => {
    process.env[CACHE_TTL_ENV] = String(HOUR);
    const bound = Date.now() + 6_000;
    await grant('falls', { valid_until: iso(bound) });
    await grant('rises', { valid_from: iso(bound) });

    // The cache is live: a second request for the same principal before the
    // bound is served without reading the grant table for them.
    const find = vi.spyOn(ql, 'find');
    const grantReads = (who: string) =>
      find.mock.calls.filter(([object, q]: any[]) => object === GRANTS && q?.where?.user_id === uid[who]).length;
    expect(await door('falls'), 'inside the window').toBe(200);
    expect(await door('rises'), 'before the window').toBe(403);
    const readsAfterFirst = grantReads('falls');
    expect(readsAfterFirst, 'the first request resolves the grant from the table').toBeGreaterThan(0);
    expect(await door('falls'), 'still inside the window').toBe(200);
    expect(Date.now(), 'the cached leg ran before the bound').toBeLessThan(bound);
    expect(grantReads('falls'), 'the second request is served from the cache').toBe(readsAfterFirst);

    await sleepUntil(bound + 50);
    expect(await door('falls'), 'the first request after valid_until is refused').toBe(403);
    expect(await door('rises'), 'the first request after valid_from is served').toBe(200);
    find.mockRestore();
    delete process.env[CACHE_TTL_ENV];
  }, 30_000);

  it('the door refuses a window whose end is not after its start, and the boot stores none', async () => {
    const stored: any[] = await ql.find(GRANTS, { where: {}, limit: 10_000, context: SYS });
    const inverted = stored.filter(
      (r) => r.valid_from != null && r.valid_until != null && Date.parse(r.valid_until) <= Date.parse(r.valid_from),
    );
    expect(inverted, 'stored assignments with an inverted window').toEqual([]);

    const at = Date.now() + DAY;
    const res = await stack.apiAs(adminTok, 'POST', `/data/${GRANTS}`, {
      user_id: uid.bare, permission_set_id: setId, valid_from: iso(at), valid_until: iso(at - HOUR),
    });
    const body = (await res.json()) as any;
    expect([res.status, body?.code]).toEqual([400, 'VALIDATION_FAILED']);
    expect((body?.fields ?? []).map((f: any) => [f.field, f.code])).toEqual([['valid_until', 'rule_violation']]);
    expect(await ql.find(GRANTS, { where: { user_id: uid.bare }, context: SYS })).toEqual([]);
  });
});

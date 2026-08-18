// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// FLS — the READ side of `access-security.fls-mask-and-strip` (#9481).
//
// The item's existing pin (`showcase-permission-zoo.dogfood.test.ts`, FLS budget
// case) covers the WRITE half only, and its `automated.ref` says so. This file
// is the read half: what an UNENTITLED persona actually receives on the wire.
//
// ── MASKED vs STRIPPED: two different mechanisms, two different wire shapes ──
//
// The platform has TWO ways a field can fail to reach a caller, and they are not
// interchangeable. `plugin-security/src/field-masker.ts` implements both:
//
//   STRIPPED — a permission set marks the field `readable: false`. `maskRecord`
//     DELETES the key. The field is ABSENT from the response object: not null,
//     not empty string, not a placeholder. This is the mechanism this checklist
//     item is about, and the one asserted below.
//
//   MASKED — the FIELD declares a `maskingRule` (#8993) the caller has not
//     unmasked. `maskRecord` REPLACES the value (`138****5678`). The key is
//     PRESENT and its value is a mask image.
//
// A test that only asserts "I did not get the real value" passes for BOTH and
// pins NEITHER. So the assertions below are about the KEY, not just the value:
// `'budget' in record` must be false. If the strip ever degrades into a null —
// or into a masking-rule placeholder — the shape changes and this goes red,
// which a `toBeUndefined()`-style assertion would not catch (`in` distinguishes
// an absent key from a present-but-undefined one; `record.budget === undefined`
// does not).
//
// ⚠️ Scope, stated so nobody reads more into this file than it proves: the
// MASKED half is NOT pinned here and cannot be, on the stock showcase. No object
// anywhere in this repo declares a `maskingRule` — the showcase declares none,
// so there is no fixture whose masked value could be asserted, and inventing one
// would change what the stock showcase means. The masked half stays manual; see
// the item's re-scoped `automated.ref`.
//
// ── The fixture, and why it is authored at runtime ───────────────────────────
//
// Stock showcase authors NO `readable: false` FLS grant — its only `fields`
// block is `showcase_contributor`'s three `readable: true, editable: false`
// entries. That is the item's own recorded `knownGaps`, and #9308 is the open
// card that would land such a grant in the SEED. Until it does, the item's own
// steps prescribe exactly what this file does: author a SCRATCH permission set
// carrying `readable: false` and grant it to a fresh member. The scratch set
// lives only inside this test's stack — the showcase's committed metadata is
// untouched, so what the stock app declares is unchanged.
//
// Why a private boot rather than the worker-shared showcase: this file inserts a
// `sys_permission_set` row, which the shared harness's eligibility rules exclude
// outright (no permission-set metadata edits — see `shared-showcase.ts`).
//
// ── One thing measured here and deliberately NOT asserted ────────────────────
//
// `showcase_project.budget_remaining` is a FORMULA over `budget` and `spent`,
// and it is served to the denied member alongside `spent` — so the stripped
// value is recoverable exactly (`budget = budget_remaining + spent`, confirmed
// against the system-context row). That is filed as #9562, out of this card's
// scope, with the three readings. It is recorded here and asserted NOWHERE: an
// assertion pinning today's behaviour would turn a future fix into a red, and an
// assertion pinning the fix would be red today. The strip assertions below are
// scoped to the field the scratch set actually enumerates.
//
// ── Both sides, always ───────────────────────────────────────────────────────
//
// Every deny below is paired with the entitled contrast on the SAME field, row
// and request. A read-side FLS suite that only asserted absence would stay green
// if the field vanished for everyone, which is an over-tightening regression,
// not a fix.
//
// @proof: showcase-fls-read-mask-strip

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { showcaseAppDefaultSecurity } from './showcase-security.js';

const SYS = { isSystem: true } as const;

/** The field the scratch set denies READ on. */
const DENIED = 'budget';
/**
 * A sibling currency field on the SAME object that the scratch set does NOT
 * enumerate. It is the per-field discrimination control: without it, "budget is
 * gone" is equally consistent with "the whole row is gone" and with "every
 * currency field is gone".
 */
const KEPT = 'spent';
const SCRATCH_SET = 'showcase_scratch_fls_read_deny';
const MEMBER = 'fls-read-side@verify.test';

const recordOf = (b: any) => b?.record ?? b?.data ?? b;
const rowsOf = (b: any) => b?.records ?? b?.data ?? (Array.isArray(b) ? b : []);

describe('showcase FLS read side: a readable:false field is STRIPPED, not masked (#9481)', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string;
  let memberTok: string;
  let projectId: string;
  let storedBudget: number;
  let storedSpent: number;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, { security: showcaseAppDefaultSecurity() });
    adminTok = await stack.signIn();
    memberTok = await stack.signUp(MEMBER);
    ql = await stack.kernel.getServiceAsync('objectql');

    // The scratch grant. `object_permissions` is deliberately EMPTY: the app's
    // own everyone-baseline (`showcase_member_default`) already grants read on
    // `showcase_project`, so this set contributes nothing but the field deny —
    // which is what makes the assertions below attributable to FLS alone.
    //
    // `active: true` is load-bearing: the security plugin's DB loader filters
    // deactivated rows out (`isRowActive`), and an inactive set grants nothing,
    // including nothing to deny — the field would come back readable and every
    // assertion here would fail as if the strip were broken.
    await ql.insert(
      'sys_permission_set',
      {
        name: SCRATCH_SET,
        label: 'Scratch: FLS read deny on showcase_project.budget',
        description:
          'Test-authored (#9481). Stock showcase authors no readable:false grant — see #9308.',
        object_permissions: JSON.stringify({}),
        // Object-QUALIFIED key. A bare `budget` key silently enforces nothing:
        // the evaluator matches `<object>.<field>` prefixes, which is the exact
        // defect the permission-zoo audit found on the write half.
        field_permissions: JSON.stringify({
          [`showcase_project.${DENIED}`]: { readable: false, editable: false },
        }),
        system_permissions: JSON.stringify([]),
        active: true,
      },
      { context: SYS },
    );
    const ps = await ql.findOne('sys_permission_set', { where: { name: SCRATCH_SET }, context: SYS });
    expect(ps?.id, 'scratch permission set authored').toBeTruthy();
    const memberId = (await ql.findOne('sys_user', { where: { email: MEMBER }, context: SYS }))?.id;
    expect(memberId, 'member provisioned').toBeTruthy();
    await ql.insert(
      'sys_user_permission_set',
      { user_id: memberId, permission_set_id: ps.id },
      { context: SYS },
    );

    const projects = await ql.find('showcase_project', { where: {}, context: SYS });
    const target = (projects ?? []).find(
      (p: any) => p[DENIED] != null && Number(p[DENIED]) > 0 && p[KEPT] != null,
    );
    expect(target, `a seeded showcase_project with a non-null ${DENIED} and ${KEPT}`).toBeTruthy();
    projectId = target.id;
    storedBudget = Number(target[DENIED]);
    storedSpent = Number(target[KEPT]);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  // ── The strip, on the single-record read ─────────────────────────────────
  it('by-id GET: the denied field is ABSENT from the record — the key is gone, not nulled', async () => {
    const r = await stack.apiAs(memberTok, 'GET', `/data/showcase_project/${projectId}`);
    expect(r.status, 'the ROW is still served — FLS is a field gate, not a row gate').toBe(200);
    const record = recordOf(await r.json());

    // The distinction, asserted three ways so no single weaker reading passes:
    expect(
      Object.prototype.hasOwnProperty.call(record, DENIED),
      `${DENIED} must be absent from the response shape (stripped), not present-and-nulled`,
    ).toBe(false);
    expect(Object.keys(record), 'the key does not appear in the served projection').not.toContain(DENIED);
    // And it is not smuggled back as a masking-rule placeholder under its own name.
    expect(record[DENIED], 'no placeholder value is served in its place').toBeUndefined();
  });

  it('the same record still carries its other fields — the strip is per-FIELD, not per-row', async () => {
    const r = await stack.apiAs(memberTok, 'GET', `/data/showcase_project/${projectId}`);
    const record = recordOf(await r.json());
    expect(record.name, 'an unrestricted text field is served').toBeTruthy();
    expect(
      Object.prototype.hasOwnProperty.call(record, KEPT),
      `${KEPT} is not enumerated by the scratch set and must survive`,
    ).toBe(true);
    expect(Number(record[KEPT]), 'and it carries its REAL value, not a masked one').toBe(storedSpent);
  });

  // ── The entitled contrast — the allow half ───────────────────────────────
  it('admin reads the SAME row and the field is present with its real value (both sides)', async () => {
    const r = await stack.apiAs(adminTok, 'GET', `/data/showcase_project/${projectId}`);
    expect(r.status).toBe(200);
    const record = recordOf(await r.json());
    expect(
      Object.prototype.hasOwnProperty.call(record, DENIED),
      'the entitled caller still receives the field — the lock keys on the CALLER, not the field',
    ).toBe(true);
    expect(Number(record[DENIED])).toBe(storedBudget);
  });

  // ── The strip on the LIST path ───────────────────────────────────────────
  it('list GET: every row is stripped for the member and intact for admin', async () => {
    const m = await stack.apiAs(memberTok, 'GET', '/data/showcase_project');
    expect(m.status).toBe(200);
    const memberRows = rowsOf(await m.json());
    expect(memberRows.length, 'the member sees rows at all (baseline read on a public object)').toBeGreaterThan(0);
    for (const row of memberRows) {
      expect(
        Object.prototype.hasOwnProperty.call(row, DENIED),
        `${DENIED} stripped from every listed row (id ${row.id})`,
      ).toBe(false);
    }

    const a = await stack.apiAs(adminTok, 'GET', '/data/showcase_project');
    const adminRows = rowsOf(await a.json());
    expect(adminRows.length, 'admin sees rows too').toBeGreaterThan(0);
    expect(
      adminRows.some((row: any) => Object.prototype.hasOwnProperty.call(row, DENIED)),
      'admin still receives the field in lists — the list strip is caller-keyed',
    ).toBe(true);
  });

  // ── Explicitly ASKING for the field does not get it back ─────────────────
  it('an explicit `select` of the denied field returns the record WITHOUT it (no error, no value)', async () => {
    const m = await stack.apiAs(
      memberTok,
      'GET',
      `/data/showcase_project/${projectId}?select=name,${DENIED}`,
    );
    expect(m.status, 'naming a stripped field in a projection is not itself an error').toBe(200);
    const record = recordOf(await m.json());
    expect(record.name, 'the readable half of the projection is served').toBeTruthy();
    expect(
      Object.prototype.hasOwnProperty.call(record, DENIED),
      'the projection cannot re-open the strip',
    ).toBe(false);

    const a = await stack.apiAs(
      adminTok,
      'GET',
      `/data/showcase_project/${projectId}?select=name,${DENIED}`,
    );
    const adminRecord = recordOf(await a.json());
    expect(Number(adminRecord[DENIED]), 'the same projection serves admin the value').toBe(storedBudget);
  });

  // ── The filter/sort oracle — absence is not enough on its own ────────────
  //
  // A stripped field that can still be FILTERED or SORTED on is only cosmetically
  // hidden: `budget gt N` answered honestly is a binary search for the value.
  // The security plugin refuses those queries by name; these two cases pin the
  // refusal AND the entitled caller's continued ability to run them.
  it('filtering on the stripped field is refused 403 PERMISSION_DENIED, naming the field', async () => {
    const filter = encodeURIComponent(JSON.stringify({ [DENIED]: { $gt: 0 } }));
    const m = await stack.apiAs(memberTok, 'GET', `/data/showcase_project?$filter=${filter}`);
    expect(m.status, 'the filter oracle is closed').toBe(403);
    const body: any = await m.json();
    expect(body?.code).toBe('PERMISSION_DENIED');
    expect(String(body?.error), 'the refusal names the offending field').toContain(DENIED);

    const a = await stack.apiAs(adminTok, 'GET', `/data/showcase_project?$filter=${filter}`);
    expect(a.status, 'the entitled caller can still filter on it').toBe(200);
    expect(rowsOf(await a.json()).length).toBeGreaterThan(0);
  });

  it('sorting on the stripped field is refused 403 PERMISSION_DENIED (ordering leaks it too)', async () => {
    const m = await stack.apiAs(memberTok, 'GET', `/data/showcase_project?sort=${DENIED}`);
    expect(m.status).toBe(403);
    const body: any = await m.json();
    expect(body?.code).toBe('PERMISSION_DENIED');
    expect(String(body?.error)).toContain(DENIED);

    const a = await stack.apiAs(adminTok, 'GET', `/data/showcase_project?$orderby=${DENIED} desc`);
    expect(a.status, 'the entitled caller can still sort on it').toBe(200);
  });

  // ── The write complement of a READ deny ──────────────────────────────────
  //
  // Distinct from the permission-zoo write pin, which exercises the showcase's
  // `readable: true, editable: false` grant. This is the OTHER shape: a field the
  // caller cannot even read must not be writable either, and the value oracle —
  // not the status — is what decides.
  it('a field the caller cannot READ cannot be written either, and the stored value is unchanged', async () => {
    const r = await stack.apiAs(memberTok, 'PATCH', `/data/showcase_project/${projectId}`, {
      [DENIED]: 1,
    });
    expect(r.status, 'write to an unreadable field is refused').toBe(403);
    expect((await r.json())?.code).toBe('PERMISSION_DENIED');
    const after = await ql.findOne('showcase_project', { where: { id: projectId }, context: SYS });
    expect(Number(after[DENIED]), 'the stored value is untouched').toBe(storedBudget);
  });
});

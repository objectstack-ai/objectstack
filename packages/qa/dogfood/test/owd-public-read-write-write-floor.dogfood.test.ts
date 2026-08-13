// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#8023] A `public_read_write` OWD must actually open row-level WRITES.
//
// ── the measured symptom ──────────────────────────────────────────────────
// QA run #7637's matrix re-drive found exactly one failing cell of 124: a
// `showcase_contributor` that the access matrix grants `edit: true` on
// `showcase_project` (OWD `public_read_write`, zero authored RLS) could GET a
// seeded row 200 and PATCH it 403 — with the RECORD-level sentence, not the
// object-level one.
//
// ── the mechanism ─────────────────────────────────────────────────────────
// `member_default` ships the platform's row-level write ownership floor
// (`owner_only_writes`, object `'*'`, operation `update`,
// `created_by == current_user.id`, positions `['org_member']` — the seed lives
// in `plugin-security/src/objects/default-permission-sets.ts`). The by-id
// write pre-image gate lets `ISharingService`'s tri-state verdict REPLACE that
// floor, but only on `allow`; on a `public_read_write` object the service
// ABSTAINS (record sharing does not enforce there at all), and an abstain
// KEEPS the floor. Net effect: the OWD declared "everyone reads and writes"
// and the runtime enforced "only the creator writes".
//
// ── the fix this file pins ────────────────────────────────────────────────
// The floor is now conditioned on the object's OWD at COLLECTION time: an
// object that explicitly declares `sharingModel: 'public_read_write'` never
// inherits the wildcard `update` floor in the first place. Two consequences
// this file measures rather than assumes:
//
//   - because the floor leaves the update class EMPTY, #7665's
//     derive-from-select then supplies the write scope, so "you cannot mutate
//     what you cannot see" still holds on the very same object (case D);
//   - the DELETE floor is untouched. `public_read_write` is "everyone can see
//     and edit" (`spec/security/sharing.zod.ts`); the legacy `full` alias that
//     also covered transfer/delete was removed for having no lossless target
//     precisely because it is WIDER than `public_read_write`
//     (`spec/conversions/registry.ts`). Case E pins that boundary.
//
// ── why this file is HTTP-level ───────────────────────────────────────────
// The harm is an HTTP `PATCH` answering 403. A unit assertion about a compiled
// filter is supporting evidence for the mechanism; it is not evidence that the
// symptom is gone. Every acceptance case below drives the real REST stack.
//
// ── the ONE difference between the three objects ──────────────────────────
// `owdw_open` / `owdw_read` / `owdw_secret` are byte-identical apart from
// their `sharingModel`. Whatever separates their verdicts is the OWD and
// nothing else — the same discriminator idiom as
// `authored-row-write-scope.dogfood.test.ts`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { defineStack, definePermissionSet } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { resolveAuthzContext } from '@objectstack/core';
import { BUILTIN_OPERATION_MESSAGES } from '@objectstack/spec/system';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { assertArmed, principalArmed } from './armed.js';

/**
 * [#8074] The control every case below measures, and the default that silences
 * it. The first fixture written for #8023 was org-less and PASSED against the
 * known-broken build; `assertArmed` in `beforeAll` is what now makes that
 * impossible rather than merely documented.
 */
const WRITE_FLOOR =
  "the platform's wildcard row-level write floor (`owner_only_writes`, positions ['org_member'])";
const WRITE_FLOOR_DISARM =
  'an org-less harness: no organization ⇒ no `sys_member` row ⇒ a fresh sign-up holds only ' +
  "`['everyone']` ⇒ the positions-gated floor never applies and every case here passes on the " +
  'broken build. `orgContext: true` in the boot options above is what arms it.';

// ── the three objects, identical but for the OWD ───────────────────────────

const OPEN = 'owdw_open';      // public_read_write — writes DECLARED open
const READ = 'owdw_read';      // public_read       — reads open, owner writes
const SECRET = 'owdw_secret';  // private           — owner reads and writes

const commonFields = () => ({
  title: Field.text({ label: 'Title', required: true, maxLength: 160 }),
  body: Field.text({ label: 'Body', maxLength: 2000 }),
  stage: Field.text({ label: 'Stage', maxLength: 40 }),
  owner_id: Field.lookup('sys_user', { label: 'Owner' }),
});

const mk = (name: string, sharingModel: string) =>
  ObjectSchema.create({
    name,
    label: `OWD Write ${name}`,
    pluralLabel: `OWD Write ${name}s`,
    sharingModel: sharingModel as never,
    fields: commonFields(),
  });

/**
 * The persona the access matrix grants `edit: true` — the card's
 * `showcase_contributor`. Holds the object-level bits on all three objects and
 * authors NO row-level policy: every row-level verdict it gets comes from the
 * platform baseline plus the OWD, exactly as on the showcase.
 *
 * `allowDelete` is granted DELIBERATELY on `owdw_open` so case E's refusal is
 * unambiguously the row-level delete floor rather than a missing object bit.
 */
const EditorSet = definePermissionSet({
  name: 'owdw_editor',
  label: 'OWD Write — object-level read+edit (the matrix says edit:true)',
  objects: {
    [OPEN]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    [READ]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    [SECRET]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
});

/**
 * The OBJECT-level control — the card's `member_default` persona: reads the
 * object, `allowEdit: false`. Its refusal must keep its own distinct sentence,
 * because "the object gate refused you" and "the row gate refused you" are
 * different facts with different remedies.
 */
const ViewerSet = definePermissionSet({
  name: 'owdw_viewer',
  label: 'OWD Write — object-level read only (edit:false)',
  objects: {
    [OPEN]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
  },
});

/**
 * The #7792 control: the SAME object-level grant as the editor, plus a
 * SELECT-ONLY narrowing. Dropping the write floor must not resurrect the by-id
 * write-visibility hole — a caller still may not write a row outside the set
 * it can read.
 */
const ScopedSet = definePermissionSet({
  name: 'owdw_scoped',
  label: 'OWD Write — read+edit with a select-only narrowing',
  objects: {
    [OPEN]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
  },
  rowLevelSecurity: [
    { name: 'owdw_scoped_open_rows', object: OPEN, operation: 'select', using: "stage == 'open'" },
  ],
});

const probeApp = defineStack({
  manifest: {
    id: 'com.example.owdwritefloor',
    namespace: 'owdw',
    version: '0.0.1',
    type: 'app',
    name: 'OWD public_read_write Write Floor Probe',
    engines: { protocol: '^17' },
  },
  objects: [mk(OPEN, 'public_read_write'), mk(READ, 'public_read'), mk(SECRET, 'private')],
  permissions: [EditorSet, ViewerSet, ScopedSet],
});

const SYS = { isSystem: true } as const;
const EN = BUILTIN_OPERATION_MESSAGES.en!;
const RECORD_SENTENCE = EN.record_access_denied!;
const OBJECT_SENTENCE = EN.permission_denied!;

const idOf = (b: any) => b?.id ?? b?.record?.id ?? b?.data?.id ?? b?.recordId;

describe('[#8023] a public_read_write OWD opens row-level writes (and nothing else)', () => {
  let stack: VerifyStack;
  let ql: any;
  let aliceToken: string;   // creates every row — the `created_by` the floor keys on
  let bobToken: string;     // edit:true, created nothing
  let mallyToken: string;   // edit:false — the object-level control
  let carolToken: string;   // edit:true + select-only narrowing — the #7792 control
  let aliceId: string;
  let bobId: string;

  /** row ids, per object */
  const rows: Record<string, { aliceOpen: string; aliceClosed: string; bobOwn: string }> = {};

  const patchAs = (token: string, object: string, id: string, body: Record<string, unknown>) =>
    stack.apiAs(token, 'PATCH', `/data/${object}/${id}`, body);

  const envelopeOf = async (res: any) => {
    try { return (await res.json()) as any; } catch { return null; }
  };

  /** The SAME authz context the REST entry point builds — never a hand-rolled principal. */
  const authzFor = async (token: string) => {
    const authService: any = await stack.kernel.getServiceAsync('auth');
    let api: any = authService?.api;
    if (!api && typeof authService?.getApi === 'function') api = await authService.getApi();
    const headers = new Headers({ authorization: `Bearer ${token}` });
    return resolveAuthzContext({
      ql,
      headers,
      getSession: async (h: any) => api?.getSession?.({ headers: h }),
    });
  };

  beforeAll(async () => {
    stack = await bootStack(probeApp, {
      // ⚠️ LOAD-BEARING, and measured: the platform write floor is
      // positions-gated to `org_member`, which a principal only holds through a
      // `sys_member` row (`resolve-authz-context.ts` maps the membership role).
      // An org-LESS harness gives a fresh sign-up `positions: ['everyone']`, the
      // floor never applies, and case A passes on the BROKEN build — the fixture
      // would be green over the defect it exists to pin. `orgContext: true`
      // stands up the default organization the membership reconciler binds new
      // users to (ADR-0093 D1), which is the shape a real deployment boots in
      // and the shape QA run #7637 measured.
      orgContext: true,
      security: new SecurityPlugin({
        defaultPermissionSets: [
          ...securityDefaultPermissionSets,
          EditorSet as any,
          ViewerSet as any,
          ScopedSet as any,
        ],
        fallbackPermissionSet: 'member_default',
      }),
    });
    await stack.signIn(); // dev admin seed (first user)
    aliceToken = await stack.signUp('owdw-alice@verify.test');
    bobToken = await stack.signUp('owdw-bob@verify.test');
    mallyToken = await stack.signUp('owdw-mallory@verify.test');
    carolToken = await stack.signUp('owdw-carol@verify.test');

    ql = await stack.kernel.getServiceAsync('objectql');

    const uid = async (email: string) =>
      (await ql.findOne('sys_user', { where: { email }, context: { ...SYS } }))?.id;
    aliceId = await uid('owdw-alice@verify.test');
    bobId = await uid('owdw-bob@verify.test');
    const mallyId = await uid('owdw-mallory@verify.test');
    const carolId = await uid('owdw-carol@verify.test');

    const bindSet = async (userId: string, name: string) => {
      const setRow = await ql.findOne('sys_permission_set', { where: { name }, context: { ...SYS } });
      expect(setRow?.id, `the app-declared set '${name}' is seeded`).toBeTruthy();
      await ql.insert(
        'sys_user_permission_set',
        { user_id: userId, permission_set_id: setRow.id },
        { context: { ...SYS } },
      );
    };
    await bindSet(aliceId, 'owdw_editor');
    await bindSet(bobId, 'owdw_editor');
    await bindSet(mallyId, 'owdw_viewer');
    await bindSet(carolId, 'owdw_scoped');

    // [#8074] The precondition the header above records in prose, now read off
    // the live stack and enforced BEFORE anything is measured. It is asserted
    // here rather than in an `it()` on purpose: a disarmed fixture must produce
    // ZERO green cells, and #8023's harm was exactly one green cell in a
    // 124-cell matrix re-drive. The `[integrity]` case below keeps its own copy
    // of the positions check — it is redundant with this gate by design, since
    // it also proves the facts this gate cannot (who created which row, and
    // that the three objects differ only by their OWD).
    await assertArmed([
      principalArmed({
        stack,
        token: bobToken,
        who: 'bob (the edit:true persona)',
        positions: ['org_member'],
        permissions: ['owdw_editor'],
        control: WRITE_FLOOR,
        disarmedBy: WRITE_FLOOR_DISARM,
      }),
      principalArmed({
        stack,
        token: carolToken,
        who: 'carol (the #7792 select-narrowed persona)',
        positions: ['org_member'],
        permissions: ['owdw_scoped'],
        control: WRITE_FLOOR,
        disarmedBy: WRITE_FLOOR_DISARM,
      }),
    ]);

    // Rows are created over HTTP by ALICE so `created_by` is genuinely hers —
    // a system-context seed would stamp no creator and the floor under test
    // would never engage.
    for (const object of [OPEN, READ, SECRET]) {
      const mkRow = async (token: string, stage: string, title: string) => {
        const res = await stack.apiAs(token, 'POST', `/data/${object}`, {
          title,
          stage,
          body: 'seed',
          owner_id: token === aliceToken ? aliceId : bobId,
        });
        expect(res.status, `${object}: ${title} created`).toBeLessThan(300);
        return idOf(await res.json()) as string;
      };
      rows[object] = {
        aliceOpen: await mkRow(aliceToken, 'open', 'alice open'),
        aliceClosed: await mkRow(aliceToken, 'closed', 'alice closed'),
        bobOwn: await mkRow(bobToken, 'open', 'bob own'),
      };
    }
  }, 180_000);

  afterAll(async () => { await stack?.stop(); });

  // ── integrity: the fixture really is the measured shape ───────────────────
  //
  // Every case below is worthless if Bob quietly created the rows, if the
  // platform floor is outside its `positions` domain for these personas (it is
  // gated to `org_member`), or if the three objects differ by more than the
  // OWD. Assert all three BEFORE measuring.

  it('[integrity] alice created every probed row, bob holds the floor domain, the objects differ only by OWD', async () => {
    for (const object of [OPEN, READ, SECRET]) {
      const row = await ql.findOne(object, { where: { id: rows[object]!.aliceOpen }, context: { ...SYS } });
      expect(row?.created_by, `${object}: alice is the creator of the probed row`).toBe(aliceId);
      const own = await ql.findOne(object, { where: { id: rows[object]!.bobOwn }, context: { ...SYS } });
      expect(own?.created_by, `${object}: bob created his own control row`).toBe(bobId);
    }

    // The floor is positions-gated to `org_member`. If these personas did not
    // hold that position, every refusal below would come from somewhere else
    // and the file would be pinning a different mechanism than it claims.
    const bobCtx = await authzFor(bobToken);
    expect(bobCtx?.userId, 'the resolved principal is Bob').toBe(bobId);
    expect(bobCtx?.positions, 'bob is inside the platform write floor’s positions domain')
      .toContain('org_member');
    expect(bobCtx?.permissions, 'and holds the edit:true set').toContain('owdw_editor');

    const schemas = [OPEN, READ, SECRET].map((o) => ql.getSchema(o));
    expect(schemas.map((s: any) => s.sharingModel))
      .toEqual(['public_read_write', 'public_read', 'private']);
    for (const s of schemas) {
      expect(Object.keys(s.fields ?? {}).sort(), 'identical field sets')
        .toEqual(Object.keys(schemas[0]!.fields ?? {}).sort());
    }
  });

  // ── A. the headline (acceptance criterion 1) ──────────────────────────────

  it('[A public_read_write] an edit:true persona PATCHes a row it did NOT create → 2xx', async () => {
    const res = await patchAs(bobToken, OPEN, rows[OPEN]!.aliceOpen, { body: 'contributor edit' });
    expect(res.status, `PATCH ${OPEN} (created by alice) as an edit:true persona`).toBeLessThan(300);

    const row = await ql.findOne(OPEN, { where: { id: rows[OPEN]!.aliceOpen }, context: { ...SYS } });
    expect(row?.body, 'the value actually persisted').toBe('contributor edit');
  });

  it('[A control] the same persona still PATCHes its OWN row', async () => {
    const res = await patchAs(bobToken, OPEN, rows[OPEN]!.bobOwn, { body: 'own edit' });
    expect(res.status).toBeLessThan(300);
  });

  // ── B. the object-level gate is untouched (acceptance criterion 2) ─────────

  it('[B object gate] an edit:false persona is refused with the OBJECT-level sentence, not the record one', async () => {
    const res = await patchAs(mallyToken, OPEN, rows[OPEN]!.aliceOpen, { body: 'viewer edit' });
    expect(res.status, 'object-level refusal').toBe(403);

    const envelope = await envelopeOf(res);
    expect(envelope?.code, 'ADR-0112 error code').toBe('PERMISSION_DENIED');
    const text = JSON.stringify(envelope);
    expect(text, 'the object-level sentence').toContain(OBJECT_SENTENCE);
    expect(text, 'and NOT the record-level one — the two must stay distinguishable')
      .not.toContain(RECORD_SENTENCE);
  });

  // ── C. the floor still refuses where the OWD does not open writes (criterion 3) ──

  it('[C public_read] a non-creator write is STILL refused (403 PERMISSION_DENIED, record-level sentence)', async () => {
    const res = await patchAs(bobToken, READ, rows[READ]!.aliceOpen, { body: 'should not land' });
    expect(res.status, `PATCH ${READ} across creators`).toBe(403);
    const envelope = await envelopeOf(res);
    expect(envelope?.code, 'ADR-0112 error code').toBe('PERMISSION_DENIED');
    expect(JSON.stringify(envelope), 'the RECORD-level sentence').toContain(RECORD_SENTENCE);

    const row = await ql.findOne(READ, { where: { id: rows[READ]!.aliceOpen }, context: { ...SYS } });
    expect(row?.body, 'nothing persisted').toBe('seed');
  });

  it('[C private] a non-creator write is STILL refused', async () => {
    const res = await patchAs(bobToken, SECRET, rows[SECRET]!.aliceOpen, { body: 'should not land' });
    expect(res.status, `PATCH ${SECRET} across creators`).toBeGreaterThanOrEqual(400);
    const envelope = await envelopeOf(res);
    expect(JSON.stringify(envelope)).toMatch(/PERMISSION_DENIED|RECORD_NOT_ACCESSIBLE|NOT_FOUND/);

    const row = await ql.findOne(SECRET, { where: { id: rows[SECRET]!.aliceOpen }, context: { ...SYS } });
    expect(row?.body, 'nothing persisted').toBe('seed');
  });

  it('[C control] the owner-writes half of both OWDs still WORKS (a creator edits its own row)', async () => {
    for (const object of [READ, SECRET]) {
      const res = await patchAs(bobToken, object, rows[object]!.bobOwn, { body: 'own edit' });
      expect(res.status, `${object}: creator edits own row`).toBeLessThan(300);
    }
  });

  // ── D. #7792 by-id write visibility is not regressed (criterion 4) ─────────

  it('[D #7792] a select-only-narrowed persona still cannot write a row OUTSIDE its select scope', async () => {
    // In scope (`stage == 'open'`), created by alice — the fix's benefit reaches
    // this persona too.
    const inScope = await patchAs(carolToken, OPEN, rows[OPEN]!.aliceOpen, { body: 'carol in scope' });
    expect(inScope.status, 'a readable, non-created row is writable').toBeLessThan(300);

    // Out of scope (`stage == 'closed'`) — invisible on the read side, so the
    // write must stay refused. This is what derive-from-select supplies once
    // the floor is gone.
    const readBack = await stack.apiAs(carolToken, 'GET', `/data/${OPEN}/${rows[OPEN]!.aliceClosed}`);
    expect(readBack.status, 'the out-of-scope row is not even readable').toBeGreaterThanOrEqual(400);

    const outOfScope = await patchAs(carolToken, OPEN, rows[OPEN]!.aliceClosed, { body: 'must not land' });
    expect(outOfScope.status, 'an unreadable row must not be writable').toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(await envelopeOf(outOfScope)))
      .toMatch(/PERMISSION_DENIED|RECORD_NOT_ACCESSIBLE|NOT_FOUND/);

    const row = await ql.findOne(OPEN, { where: { id: rows[OPEN]!.aliceClosed }, context: { ...SYS } });
    expect(row?.body, 'nothing persisted').toBe('seed');
  });

  // ── F. the SECOND consumer of the same composition ────────────────────────
  //
  // `POST /security/explain` reads the identical `computeLayeredRlsFilter`, so
  // the card's other measurement — the rls layer reporting `narrows` for
  // `update` on an object with ZERO authored RLS, while `read` reported
  // `not_applicable` — has to move with the fix or the two consumers disagree.
  // The `delete` probe is the control: same object, same principal, same
  // request shape, and it must STILL report a narrowing because the delete
  // floor is deliberately kept.

  it('[F explain] update stops reporting a phantom narrowing; delete on the same object still reports one', async () => {
    const layerOf = async (operation: string, object: string) => {
      const res = await stack.apiAs(bobToken, 'POST', '/security/explain', { object, operation, userId: bobId });
      expect(res.status, `explain ${operation} ${object}`).toBe(200);
      const body: any = await res.json();
      return (body.layers ?? []).find((l: any) => l.layer === 'rls');
    };

    expect((await layerOf('read', OPEN))?.verdict, 'read was always correct').toBe('not_applicable');
    expect(
      (await layerOf('update', OPEN))?.verdict,
      'update must now agree with read — no RLS is authored on this object',
    ).toBe('not_applicable');
    expect(
      (await layerOf('delete', OPEN))?.verdict,
      'the delete floor is KEPT, so delete still narrows — the control that proves the fix is scoped',
    ).toBe('narrows');
    expect(
      (await layerOf('update', READ))?.verdict,
      'and an OWD that does not open writes still narrows updates',
    ).toBe('narrows');
  });

  // ── E. the boundary: public_read_write is read+EDIT, not delete ───────────

  it('[E delete floor] `public_read_write` does not open DELETE — a non-creator delete is still refused', async () => {
    const res = await stack.apiAs(bobToken, 'DELETE', `/data/${OPEN}/${rows[OPEN]!.aliceClosed}`);
    expect(res.status, 'delete is outside what public_read_write declares').toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(await envelopeOf(res)))
      .toMatch(/PERMISSION_DENIED|RECORD_NOT_ACCESSIBLE|NOT_FOUND/);

    const row = await ql.findOne(OPEN, { where: { id: rows[OPEN]!.aliceClosed }, context: { ...SYS } });
    expect(row, 'the row survives').toBeTruthy();
  });
});

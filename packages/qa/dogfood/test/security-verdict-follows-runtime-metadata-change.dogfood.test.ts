// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26596, #26698] An authorization verdict follows a runtime metadata change,
// with no restart, in both directions.
//
// ── what this file pins ───────────────────────────────────────────────────
// Admins change an object's access declaration after go-live — Studio's
// org-wide-defaults panel, a metadata save, an AI author — and rely on the
// change taking effect at once. The contract under test: the request AFTER a
// save is judged by the declaration that save wrote.
//
// Every object below is created at runtime through the metadata door
// (`PUT /meta/object/:name`), USED by a member first, and only then changed
// through the same door. Each case reads the verdict before and after the
// change, so each one is its own control: the "before" reading proves the old
// declaration was in force, and the "after" reading must be the new one's.
//
//   A  `sharingModel`, opened to `public_read_write` (#8023's ruling, reached
//      by a change rather than by an object born with that OWD);
//   B  `sharingModel`, narrowed to `public_read`;
//   C  the `access` block;
//   D  `requiredPermissions`;
//   E  `fields`.
//
// ── why this file is HTTP-level ───────────────────────────────────────────
// The verdict a member gets is an HTTP status. Every case drives the real REST
// stack: the admin saves through the metadata door, the members read and write
// through the data door. The seam-level pin (which signal the plugin listens
// to) sits beside the plugin; this file is what says the member sees it.
//
// ── why `orgContext: true` is armed in `beforeAll` ────────────────────────
// The update floor case B measures is positions-gated to `org_member` (see
// `owd-public-read-write-write-floor.dogfood.test.ts`): an org-less principal
// never meets it, and B would pass without measuring anything.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { defineStack, definePermissionSet } from '@objectstack/spec';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { BUILTIN_OPERATION_MESSAGES } from '@objectstack/spec/system';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { assertArmed, principalArmed } from './armed.js';
import { catalogPermissionSet } from './catalog-permission-set.js';

const UPDATE_FLOOR =
  "the platform's wildcard row-level update floor (`owner_only_writes`, positions ['org_member'])";
const UPDATE_FLOOR_DISARM =
  'an org-less harness: no organization ⇒ no `sys_member` row ⇒ a fresh sign-up holds only ' +
  "`['everyone']` ⇒ the positions-gated floor never applies and case B passes without measuring " +
  'it. `orgContext: true` in the boot options is what arms it.';

/** The capability case D adds to an object's `requiredPermissions`. */
const CAP = 'vfm_gate_capability';

/** The five objects, one per case, each saved at runtime by the admin. */
const OPENS = 'vfm_opens';      // A: private → public_read_write
const CLOSES = 'vfm_closes';    // B: public_read_write → public_read
const POSTURE = 'vfm_posture';  // C: access public → private
const GATED = 'vfm_gated';      // D: requiredPermissions added
const GROWS = 'vfm_grows';      // E: a field added after first use

/**
 * Every member holds a wildcard CRUD grant and authors no row-level policy, so
 * each verdict below comes from the object's own declaration plus the platform
 * baseline — the declaration is the one thing each case changes.
 */
const MemberSet = definePermissionSet({
  name: 'vfm_member',
  label: 'Verdict follows metadata — wildcard object CRUD',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
});

/** The same grant plus the capability case D gates on — D's control persona. */
const CapableSet = definePermissionSet({
  name: 'vfm_capable',
  label: 'Verdict follows metadata — wildcard object CRUD + the gate capability',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  systemPermissions: [CAP],
});

const probeApp = defineStack({
  manifest: {
    id: 'com.example.verdictfollowsmeta',
    namespace: 'vfm',
    version: '0.0.1',
    type: 'app',
    name: 'Authorization Verdict Follows Runtime Metadata Probe',
    engines: { protocol: '^18' },
  },
  permissions: [MemberSet, CapableSet],
});

const SYS = { isSystem: true } as const;
const RECORD_SENTENCE = BUILTIN_OPERATION_MESSAGES.en!.record_access_denied!;

/** The object body every case starts from; `over` is the declaration under test. */
const objectBody = (name: string, over: Record<string, unknown> = {}, extraFields: Record<string, unknown> = {}) => ({
  name,
  label: `VFM ${name}`,
  pluralLabel: `VFM ${name}s`,
  fields: {
    title: { type: 'text', label: 'Title', required: true, maxLength: 160 },
    body: { type: 'text', label: 'Body', maxLength: 2000 },
    ...extraFields,
  },
  ...over,
});

const idOf = (b: any) => b?.id ?? b?.record?.id ?? b?.data?.id ?? b?.recordId;

describe('[#26596, #26698] the authorization verdict follows a runtime metadata change', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminToken: string;
  let aliceToken: string;  // creates the rows — the `created_by` the update floor keys on
  let bobToken: string;    // the measured member: wildcard CRUD, created nothing
  let carolToken: string;  // wildcard CRUD + the capability case D gates on

  /** alice's row per object. */
  const rows: Record<string, string> = {};

  const json = async (res: Response) => {
    try { return (await res.json()) as any; } catch { return null; }
  };

  /** The admin saves through the metadata door and the door reports what it stored. */
  const save = async (body: Record<string, any>) => {
    const res = await stack.apiAs(adminToken, 'PUT', `/meta/object/${body.name}`, body);
    const out = await json(res);
    expect(res.status, `PUT /meta/object/${body.name}: ${JSON.stringify(out)}`).toBe(200);
    const read = await stack.apiAs(adminToken, 'GET', `/meta/object/${body.name}`);
    const meta = await json(read);
    expect(read.status, `GET /meta/object/${body.name}`).toBe(200);
    return meta?.item ?? meta;
  };

  const createAs = async (token: string, object: string, title: string) => {
    const res = await stack.apiAs(token, 'POST', `/data/${object}`, { title, body: 'seed' });
    const out = await json(res);
    expect(res.status, `${object}: ${title} created — ${JSON.stringify(out)}`).toBeLessThan(300);
    return String(idOf(out));
  };

  beforeAll(async () => {
    stack = await bootStack(probeApp, {
      // ⚠️ LOAD-BEARING: arms the positions-gated update floor case B
      // measures; asserted below before anything is measured.
      orgContext: true,
      security: new SecurityPlugin({ fallbackPermissionSet: 'member_default' }),
    });
    adminToken = await stack.signIn(); // dev admin seed (first user)
    aliceToken = await stack.signUp('vfm-alice@verify.test');
    bobToken = await stack.signUp('vfm-bob@verify.test');
    carolToken = await stack.signUp('vfm-carol@verify.test');

    ql = await stack.kernel.getServiceAsync('objectql');
    const uid = async (email: string) =>
      (await ql.findOne('sys_user', { where: { email }, context: { ...SYS } }))?.id;
    const bindSet = async (email: string, name: string) => {
      const setRow = await catalogPermissionSet(ql, name);
      expect(setRow, `the app-declared set '${name}' is served by the security catalog`).toBeTruthy();
      await ql.insert(
        'sys_user_permission_set',
        { user_id: await uid(email), permission_set: setRow.name },
        { context: { ...SYS } },
      );
    };
    await bindSet('vfm-alice@verify.test', 'vfm_member');
    await bindSet('vfm-bob@verify.test', 'vfm_member');
    await bindSet('vfm-carol@verify.test', 'vfm_capable');

    await assertArmed([
      principalArmed({
        stack,
        token: bobToken,
        who: 'bob (the measured member)',
        positions: ['org_member'],
        permissions: ['vfm_member'],
        control: UPDATE_FLOOR,
        disarmedBy: UPDATE_FLOOR_DISARM,
      }),
    ]);

    // Each object's FIRST declaration, saved at runtime.
    await save(objectBody(OPENS, { sharingModel: 'private' }));
    await save(objectBody(CLOSES, { sharingModel: 'public_read_write' }));
    await save(objectBody(POSTURE, { sharingModel: 'public_read_write' }));
    await save(objectBody(GATED, { sharingModel: 'public_read_write' }));
    await save(objectBody(GROWS, { sharingModel: 'public_read_write' }));

    // alice's rows, created over HTTP so `created_by` is genuinely hers.
    for (const object of [OPENS, CLOSES, POSTURE, GATED, GROWS]) {
      rows[object] = await createAs(aliceToken, object, `alice ${object}`);
    }
  }, 180_000);

  afterAll(async () => { await stack?.stop(); });

  // ── A. sharingModel, opened ─────────────────────────────────────────────────

  it('[A] the verdict follows a runtime change — sharingModel, opened', async () => {
    // Before: the private OWD keeps alice's row away from bob.
    const before = await stack.apiAs(bobToken, 'PATCH', `/data/${OPENS}/${rows[OPENS]}`, { body: 'before' });
    expect(before.status, 'under the private OWD a non-creator update is refused').toBeGreaterThanOrEqual(400);

    const saved = await save(objectBody(OPENS, { sharingModel: 'public_read_write' }));
    expect(saved?.sharingModel, 'the metadata door reports the new OWD').toBe('public_read_write');

    const read = await stack.apiAs(bobToken, 'GET', `/data/${OPENS}/${rows[OPENS]}`);
    expect(read.status, 'the row is readable under the new OWD').toBe(200);
    const after = await stack.apiAs(bobToken, 'PATCH', `/data/${OPENS}/${rows[OPENS]}`, { body: 'member edit' });
    expect(after.status, `PATCH after the change: ${JSON.stringify(await json(after))}`).toBeLessThan(300);

    const row = await ql.findOne(OPENS, { where: { id: rows[OPENS] }, context: { ...SYS } });
    expect(row?.body, 'the value actually persisted').toBe('member edit');
  });

  it('[A delete] the verdict follows a runtime change — sharingModel, opened: delete', async () => {
    const res = await stack.apiAs(bobToken, 'DELETE', `/data/${OPENS}/${rows[OPENS]}`);
    expect(res.status, 'delete stays outside what public_read_write declares').toBeGreaterThanOrEqual(400);
    const row = await ql.findOne(OPENS, { where: { id: rows[OPENS] }, context: { ...SYS } });
    expect(row, 'the row survives').toBeTruthy();
  });

  // ── B. sharingModel, narrowed ───────────────────────────────────────────────

  it('[B] the verdict follows a runtime change — sharingModel, narrowed', async () => {
    const before = await stack.apiAs(bobToken, 'PATCH', `/data/${CLOSES}/${rows[CLOSES]}`, { body: 'before' });
    expect(before.status, 'under public_read_write a non-creator update lands').toBeLessThan(300);

    const saved = await save(objectBody(CLOSES, { sharingModel: 'public_read' }));
    expect(saved?.sharingModel, 'the metadata door reports the new OWD').toBe('public_read');

    const read = await stack.apiAs(bobToken, 'GET', `/data/${CLOSES}/${rows[CLOSES]}`);
    expect(read.status, 'reads stay open under public_read').toBe(200);
    const after = await stack.apiAs(bobToken, 'PATCH', `/data/${CLOSES}/${rows[CLOSES]}`, { body: 'must not land' });
    expect(after.status, 'a non-creator update is refused under the new OWD').toBe(403);
    const envelope = await json(after);
    expect(envelope?.code, 'ADR-0112 error code').toBe('PERMISSION_DENIED');
    expect(JSON.stringify(envelope), 'the record-level sentence').toContain(RECORD_SENTENCE);

    const row = await ql.findOne(CLOSES, { where: { id: rows[CLOSES] }, context: { ...SYS } });
    expect(row?.body, 'nothing persisted after the change').toBe('before');
  });

  // ── C. the access block ─────────────────────────────────────────────────────

  it('[C] the verdict follows a runtime change — access block', async () => {
    const before = await stack.apiAs(bobToken, 'GET', `/data/${POSTURE}`);
    expect(before.status, 'a public object is covered by the wildcard grant').toBe(200);

    const saved = await save(objectBody(POSTURE, { sharingModel: 'public_read_write', access: { default: 'private' } }));
    expect(saved?.access?.default, 'the metadata door reports the new posture').toBe('private');

    const list = await stack.apiAs(bobToken, 'GET', `/data/${POSTURE}`);
    expect(list.status, 'a private object needs an explicit grant').toBe(403);
    expect((await json(list))?.code, 'ADR-0112 error code').toBe('PERMISSION_DENIED');
    const byId = await stack.apiAs(bobToken, 'GET', `/data/${POSTURE}/${rows[POSTURE]}`);
    expect(byId.status, 'by id as well').toBeGreaterThanOrEqual(400);

    // And back: the posture follows the change in the other direction too.
    await save(objectBody(POSTURE, { sharingModel: 'public_read_write', access: { default: 'public' } }));
    const reopened = await stack.apiAs(bobToken, 'GET', `/data/${POSTURE}`);
    expect(reopened.status, 'public again ⇒ covered by the wildcard grant again').toBe(200);
  });

  // ── D. requiredPermissions ──────────────────────────────────────────────────

  it('[D] the verdict follows a runtime change — requiredPermissions', async () => {
    const before = await stack.apiAs(bobToken, 'GET', `/data/${GATED}`);
    expect(before.status, 'no capability contract yet').toBe(200);
    const carolBefore = await stack.apiAs(carolToken, 'GET', `/data/${GATED}`);
    expect(carolBefore.status).toBe(200);

    const saved = await save(objectBody(GATED, { sharingModel: 'public_read_write', requiredPermissions: [CAP] }));
    expect(saved?.requiredPermissions, 'the metadata door reports the new contract').toEqual([CAP]);

    const bob = await stack.apiAs(bobToken, 'GET', `/data/${GATED}`);
    expect(bob.status, 'bob does not hold the capability').toBe(403);
    expect((await json(bob))?.code, 'ADR-0112 error code').toBe('PERMISSION_DENIED');
    const carol = await stack.apiAs(carolToken, 'GET', `/data/${GATED}`);
    expect(carol.status, 'carol holds it — the gate is the capability, not a blanket refusal').toBe(200);

    const explain = await stack.apiAs(adminToken, 'POST', '/security/explain', {
      object: GATED,
      operation: 'read',
      userId: (await ql.findOne('sys_user', { where: { email: 'vfm-bob@verify.test' }, context: { ...SYS } }))?.id,
    });
    expect(explain.status, 'explain answers').toBe(200);
    expect(JSON.stringify(await json(explain)), 'explain reads the same declaration').toContain(CAP);
  });

  // ── E. fields ───────────────────────────────────────────────────────────────

  it('[E] the verdict follows a runtime change — fields', async () => {
    const before = await stack.apiAs(bobToken, 'GET', `/meta/object/${GROWS}`);
    expect(before.status).toBe(200);
    expect(Object.keys((await json(before))?.item?.fields ?? {}), 'the field does not exist yet')
      .not.toContain('late_note');
    const rowBefore = await stack.apiAs(bobToken, 'GET', `/data/${GROWS}/${rows[GROWS]}`);
    expect(rowBefore.status).toBe(200);

    const saved = await save(objectBody(GROWS, { sharingModel: 'public_read_write' }, {
      late_note: { type: 'text', label: 'Late note', maxLength: 200 },
    }));
    expect(Object.keys(saved?.fields ?? {}), 'the metadata door reports the new field').toContain('late_note');

    const patched = await stack.apiAs(aliceToken, 'PATCH', `/data/${GROWS}/${rows[GROWS]}`, { late_note: 'added later' });
    expect(patched.status, `alice writes the new field: ${JSON.stringify(await json(patched))}`).toBeLessThan(300);

    const meta = await stack.apiAs(bobToken, 'GET', `/meta/object/${GROWS}`);
    expect(meta.status).toBe(200);
    expect(Object.keys((await json(meta))?.item?.fields ?? {}), 'the member reads the new field in the definition')
      .toContain('late_note');
    const row = await stack.apiAs(bobToken, 'GET', `/data/${GROWS}/${rows[GROWS]}`);
    expect(row.status).toBe(200);
    expect((await json(row))?.record?.late_note, 'and its value on the record').toBe('added later');
  });
});

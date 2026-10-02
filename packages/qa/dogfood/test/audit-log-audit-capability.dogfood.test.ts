// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21260] The compliance ledger's audit capability, through the public data
// doors on a real boot.
//
// The ledger (`sys_audit_log`) takes the activity stream's parent-record read
// gate (#21175): a row about a record is served only to a caller whose own
// engine read of that record finds it. Ruling B on #21175 gives the ledger an
// audit capability whose HOLDER is exempt from that gate, held by default by
// platform administrators and by every other position only by explicit grant.
// Field-level narrowing still applies to the holder.
//
// ## The composition
//
// `bootStack` with the real `SecurityPlugin`, `ObjectQL`, SQL driver, REST and
// auth layers, plus `AuditPlugin`, whose CRUD mirror and auth-event sink write
// the ledger rows and whose read seams serve them. Four principals:
//
//   - the platform administrator the harness seeds (the default holder);
//   - a HOLDER: a member granted the ledger read, the capability, and a set
//     that withholds one field of the fixture object;
//   - a READER: a member granted the ledger read and nothing else (a
//     non-holder, who gets exactly the parent-record gate);
//   - a WRITER, who writes the records the rows are about.
//
// The rows, each from its real producer except the broad read's bulk:
//   - a record the writer created and then deleted (its create and delete rows);
//   - a private record the writer owns, which neither member can open;
//   - a third member's second session, signed out (its sign-in row about an
//     ended session, and its sign-out row);
//   - a bulk of rows past the gate's pre-scan bound, inserted as the system
//     (the writers insert as the system too), about records that do not exist.
//
// `@objectstack/plugin-audit` resolves through its BUILT output here (a
// ledgered pair in `scripts/check-test-source-alias.mjs`), and so does
// `@objectstack/spec`, so a verdict on a change to either is a verdict on its
// last build. Fixtures are synthetic. ⚠️ No test title states a value.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { resolveAuthzContext } from '@objectstack/core';
import { defineStack, ADMIN_FULL_ACCESS_CAPABILITIES } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, PLATFORM_CAPABILITIES } from '@objectstack/spec/security';
import { assertArmed, armedWhen } from './armed.js';

/** The capability under test, as `PLATFORM_CAPABILITIES` declares it. */
const CAP = 'view_all_audit_log';
const LEDGER = 'sys_audit_log';
const ACTIVITY = 'sys_activity';
const OBJ = 'alc_item';
const PRIVATE = 'alc_private';
const SYS = { isSystem: true } as const;
/** The parent-record gate's pre-scan bound (`PARENT_GATE_SCAN_LIMIT` in plugin-audit). */
const SCAN_BOUND = 2_000;
const BULK = SCAN_BOUND + 50;
const PASSWORD = 'Alc-Fixture-Pass-21260';

/** Synthetic stored values, found by substring in a served snapshot. */
const VALUE = { plain: 'ALCPLAINDEL61', withheld: 'ALCWITHHELDDEL62', private: 'ALCPRIVATE63' };

const Item = ObjectSchema.create({
  name: OBJ,
  label: 'ALC Item',
  pluralLabel: 'ALC Items',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    alc_plain: Field.text({ label: 'Plain' }),
    alc_withheld: Field.text({ label: 'Withheld' }),
  },
});

const Private = ObjectSchema.create({
  name: PRIVATE,
  label: 'ALC Private',
  pluralLabel: 'ALC Privates',
  // sharingModel omitted: a custom object defaults to private (ADR-0090).
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    owner_id: Field.text({ label: 'Owner' }),
  },
});

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.audit-log-audit-capability',
    namespace: 'alc',
    version: '0.0.0',
    type: 'app',
    name: 'Audit Log Audit Capability Fixture',
    description: 'Two objects whose records the compliance ledger records, read by a holder and a non-holder of its audit capability.',
  },
  objects: [Item, Private],
});

const read = { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false };
const write = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
/** Every member: the fixture objects, plus object-level read on the ledger and the activity stream. */
const baselineSet = PermissionSetSchema.parse({
  name: 'alc_baseline',
  label: 'ALC baseline',
  objects: { [OBJ]: write, [PRIVATE]: write, [LEDGER]: read, [ACTIVITY]: read },
});
/** The explicit grant of the capability. */
const auditorSet = PermissionSetSchema.parse({ name: 'alc_auditor', label: 'ALC auditor', objects: {}, systemPermissions: [CAP] });
/** Withholds one field of the fixture object, so field narrowing has something to narrow. */
const withholdSet = PermissionSetSchema.parse({
  name: 'alc_withhold',
  label: 'ALC withhold',
  objects: {},
  fields: { [`${OBJ}.alc_withheld`]: { readable: false, editable: false } },
});

type Row = Record<string, any>;
const rowsOf = (body: any): Row[] => body?.records ?? body?.data ?? (Array.isArray(body) ? body : []);
const filterOf = (where: Record<string, unknown>) => encodeURIComponent(JSON.stringify(where));

async function waitFor<T>(load: () => Promise<T>, ok: (v: T) => boolean, what: string): Promise<T> {
  let v = await load();
  for (let i = 0; i < 40 && !ok(v); i++) {
    await new Promise((r) => setTimeout(r, 250));
    v = await load();
  }
  if (!ok(v)) throw new Error(`${what}: never observed`);
  return v;
}

describe('[#21260] the ledger audit capability exempts its holder from the parent-record read gate, and only its holder', () => {
  let stack: VerifyStack;
  let ql: any;
  const token: Record<'admin' | 'holder' | 'reader' | 'writer', string> = { admin: '', holder: '', reader: '', writer: '' };
  const id = { live: '', gone: '', private: '', endedSession: '' };
  const rowIds = { goneCreate: '', goneDelete: '', privateCreate: '', signOut: '', endedSignIn: '' };
  let bulkAtRest = 0;

  const ledgerAtRest = (where: Record<string, unknown>): Promise<Row[]> =>
    ql.find(LEDGER, { where, limit: 5_000, context: { ...SYS } });
  const servedList = async (who: keyof typeof token, object: string, where: Record<string, unknown>) => {
    const res = await stack.apiAs(token[who], 'GET', `/data/${object}?$filter=${filterOf(where)}&limit=200`);
    expect(res.status).toBe(200);
    return rowsOf(await res.json());
  };
  const servedById = async (who: keyof typeof token, rowId: string) =>
    (await stack.apiAs(token[who], 'GET', `/data/${LEDGER}/${rowId}`)).status;
  const servedTotal = async (who: keyof typeof token, where: Record<string, unknown>) => {
    const res = await stack.apiAs(token[who], 'GET', `/data/${LEDGER}?$filter=${filterOf(where)}&limit=1`);
    expect(res.status).toBe(200);
    return Number(((await res.json()) as any).total);
  };
  /** The ledger rows at rest about the fixture object, read now (the armed checks write one more). */
  const totalAtRest = (): Promise<number> =>
    ql.count(LEDGER, { where: { object_name: OBJ } }, { context: { ...SYS } });
  const heldCapabilities = async (who: keyof typeof token): Promise<string[]> => {
    const auth = await stack.kernel.getServiceAsync<any>('auth');
    const api = auth?.api ?? (typeof auth?.getApi === 'function' ? await auth.getApi() : undefined);
    const ctx = await resolveAuthzContext({
      ql,
      headers: new Headers({ authorization: `Bearer ${token[who]}` }),
      getSession: async (h: any) => api?.getSession?.({ headers: h }),
    });
    return Array.isArray(ctx?.systemPermissions) ? [...ctx.systemPermissions] : [];
  };

  beforeAll(async () => {
    stack = await bootStack(fixtureStack as unknown as Parameters<typeof bootStack>[0], {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, baselineSet, auditorSet, withholdSet],
        fallbackPermissionSet: baselineSet.name,
      }),
      extraPlugins: [new AuditPlugin()],
    });
    ql = await stack.kernel.getServiceAsync('objectql');
    // The seeded administrator first, so every sign-up below is a plain member.
    token.admin = await stack.signIn();
    const userIdOf = async (email: string) =>
      String((await ql.findOne('sys_user', { where: { email }, context: { ...SYS } }))?.id ?? '');
    const grant = async (email: string, setName: string) => {
      const set = await ql.findOne('sys_permission_set', { where: { name: setName }, context: { ...SYS } });
      expect(set?.id, `fixture permission set ${setName} seeded`).toBeTruthy();
      await ql.insert('sys_user_permission_set', { user_id: await userIdOf(email), permission_set_id: set.id }, { context: { ...SYS } });
    };
    for (const who of ['holder', 'reader', 'writer'] as const) {
      const email = `alc-${who}@verify.test`;
      token[who] = await stack.signUp(email, PASSWORD);
      await grant(email, baselineSet.name);
    }
    await grant('alc-holder@verify.test', auditorSet.name);
    await grant('alc-holder@verify.test', withholdSet.name);

    const idOf = async (res: Response) => {
      expect(res.status, 'fixture write').toBeLessThan(300);
      const j = (await res.json()) as any;
      return String(j.id ?? j.record?.id ?? j.data?.id);
    };
    id.live = await idOf(await stack.apiAs(token.writer, 'POST', `/data/${OBJ}`, { name: 'live' }));
    id.gone = await idOf(await stack.apiAs(token.writer, 'POST', `/data/${OBJ}`, {
      name: 'gone', alc_plain: VALUE.plain, alc_withheld: VALUE.withheld,
    }));
    expect((await stack.apiAs(token.writer, 'DELETE', `/data/${OBJ}/${id.gone}`)).status).toBeLessThan(300);
    id.private = await idOf(await stack.apiAs(token.writer, 'POST', `/data/${PRIVATE}`, { name: VALUE.private }));

    // A session that ended: a third member signs in a second time and signs out.
    const subjectEmail = 'alc-subject@verify.test';
    await stack.signUp(subjectEmail, PASSWORD);
    const subjectId = await userIdOf(subjectEmail);
    const second = await stack.signIn(subjectEmail, PASSWORD);
    expect((await stack.apiAs(second, 'POST', '/auth/sign-out', {})).status).toBe(200);
    const [signOut] = await waitFor(
      () => ledgerAtRest({ action: 'logout', user_id: subjectId }),
      (rows) => rows.length > 0,
      'the sign-out row',
    );
    rowIds.signOut = String(signOut.id);
    id.endedSession = String(signOut.record_id);
    const [endedSignIn] = await waitFor(
      () => ledgerAtRest({ action: 'login', record_id: id.endedSession }),
      (rows) => rows.length > 0,
      'the ended session’s sign-in row',
    );
    rowIds.endedSignIn = String(endedSignIn.id);

    const goneRows = await ledgerAtRest({ object_name: OBJ, record_id: id.gone });
    rowIds.goneCreate = String(goneRows.find((r) => r.action === 'create')?.id ?? '');
    rowIds.goneDelete = String(goneRows.find((r) => r.action === 'delete')?.id ?? '');
    rowIds.privateCreate = String((await ledgerAtRest({ object_name: PRIVATE, record_id: id.private }))[0]?.id ?? '');

    // The broad read: rows past the pre-scan bound, about records that do not exist.
    const now = new Date().toISOString();
    for (let i = 0; i < BULK; i++) {
      await ql.insert(
        LEDGER,
        { action: 'update', object_name: OBJ, record_id: `alc_bulk_${i}`, user_id: null, actor: 'svc:fixture', created_at: now },
        { context: { ...SYS } },
      );
    }
    bulkAtRest = await totalAtRest();

    await assertArmed([
      armedWhen({
        control: 'the declaration: the capability is a curated platform capability, and the platform administrator grant carries it',
        disarmedBy: 'a capability nobody declares or grants would make every holder case below a statement about a string',
        observe: async () => ({
          declared: PLATFORM_CAPABILITIES.find((c) => c.name === CAP)?.scope ?? 'undeclared',
          adminGrant: (ADMIN_FULL_ACCESS_CAPABILITIES.systemPermissions ?? []).includes(CAP),
        }),
        armed: (o) => o.declared === 'org' && o.adminGrant,
        describe: (o) => JSON.stringify(o),
      }),
      armedWhen({
        control: 'the ledger at rest holds every row this file reasons about, from its real producer',
        disarmedBy: 'a mirror or sink that stopped writing would let every negative case below pass on rows that never existed',
        observe: async () => ({ ...rowIds, bulkAtRest }),
        armed: (o) => Object.values(rowIds).every(Boolean) && o.bulkAtRest > SCAN_BOUND,
        describe: (o) => JSON.stringify(o),
      }),
      armedWhen({
        control: 'neither member can open the deleted record, the private record or the ended session; both open the live record',
        disarmedBy: 'a member who could open these records would be served their rows by the parent-record gate itself, so the exemption would measure nothing',
        observe: async () => {
          const out: Record<string, number[]> = {};
          for (const who of ['holder', 'reader'] as const) {
            out[who] = [
              (await stack.apiAs(token[who], 'GET', `/data/${OBJ}/${id.gone}`)).status,
              (await stack.apiAs(token[who], 'GET', `/data/${PRIVATE}/${id.private}`)).status,
              (await stack.apiAs(token[who], 'GET', `/data/sys_session/${id.endedSession}`)).status,
              (await stack.apiAs(token[who], 'GET', `/data/${OBJ}/${id.live}`)).status,
            ];
          }
          return out;
        },
        armed: (o) => ['holder', 'reader'].every((w) => o[w].slice(0, 3).every((s) => s === 404 || s === 403) && o[w][3] === 200),
        describe: (o) => JSON.stringify(o),
      }),
      armedWhen({
        control: 'the data plane withholds the field from the holder on the live record',
        disarmedBy: 'a holder served the withheld field would make the field-narrowing case below pass on a field nothing narrows',
        observe: async () => {
          const res = await stack.apiAs(token.writer, 'PATCH', `/data/${OBJ}/${id.live}`, { alc_withheld: 'ALCLIVE64' });
          const rec = (await (await stack.apiAs(token.holder, 'GET', `/data/${OBJ}/${id.live}`)).json()) as any;
          return { write: res.status, holderSees: 'alc_withheld' in (rec?.record ?? rec) };
        },
        armed: (o) => o.write < 300 && o.holderSees === false,
        describe: (o) => JSON.stringify(o),
      }),
      armedWhen({
        control: 'the activity stream holds rows about the deleted record',
        disarmedBy: 'a stream with no row about the deleted record would let the activity case below pass on nothing',
        observe: async () =>
          (await ql.find(ACTIVITY, { where: { object_name: OBJ, record_id: id.gone }, context: { ...SYS } })).length,
        armed: (n) => n > 0,
      }),
    ]);
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('the platform administrator holds the capability by default, through the shared authorization resolver', async () => {
    expect(await heldCapabilities('admin')).toContain(CAP);
    expect(await heldCapabilities('holder')).toContain(CAP);
    expect(await heldCapabilities('reader')).not.toContain(CAP);
  });

  it('holder: is served the rows about a deleted record, through the list and by id', async () => {
    const rows = await servedList('holder', LEDGER, { object_name: OBJ, record_id: id.gone });
    expect(rows.map((r) => r.id).sort()).toEqual([rowIds.goneCreate, rowIds.goneDelete].sort());
    expect(await servedById('holder', rowIds.goneDelete)).toBe(200);
  });

  it('holder: field narrowing still applies to the deleted record’s snapshots', async () => {
    const rows = await servedList('holder', LEDGER, { object_name: OBJ, record_id: id.gone });
    const blob = JSON.stringify(rows);
    expect(blob).not.toContain(VALUE.withheld);
    expect(blob).toContain(VALUE.plain);
    const atRest = JSON.stringify(await ledgerAtRest({ object_name: OBJ, record_id: id.gone }));
    expect(atRest).toContain(VALUE.withheld);
  });

  it('holder: is served the sign-out row and the ended session’s sign-in row', async () => {
    expect(await servedById('holder', rowIds.signOut)).toBe(200);
    expect(await servedById('holder', rowIds.endedSignIn)).toBe(200);
  });

  it('holder: is served the rows about a record it cannot open', async () => {
    expect(await servedById('holder', rowIds.privateCreate)).toBe(200);
  });

  it('holder: a broad read past the pre-scan bound is served whole', async () => {
    expect(await servedTotal('holder', { object_name: OBJ })).toBe(await totalAtRest());
  });

  it('holder: the activity stream’s gate is not exempted', async () => {
    expect(await servedList('holder', ACTIVITY, { object_name: OBJ, record_id: id.gone })).toEqual([]);
    expect(await servedList('admin', ACTIVITY, { object_name: OBJ, record_id: id.gone })).toEqual([]);
  });

  it('non-holder: gets exactly the parent-record gate — none of these rows, and a broad read bounded', async () => {
    expect(await servedList('reader', LEDGER, { object_name: OBJ, record_id: id.gone })).toEqual([]);
    for (const rowId of [rowIds.goneDelete, rowIds.signOut, rowIds.endedSignIn, rowIds.privateCreate]) {
      expect(await servedById('reader', rowId), `ledger row ${rowId}`).toBe(404);
    }
    const total = await servedTotal('reader', { object_name: OBJ });
    expect(total).toBeLessThan(SCAN_BOUND);
    expect(total).toBeLessThan(bulkAtRest);
  });

  it('non-holder control: is served the rows about the record it can open', async () => {
    const rows = await servedList('reader', LEDGER, { object_name: OBJ, record_id: id.live });
    expect(rows.length).toBeGreaterThan(0);
  });

  it('platform administrator: is served the deleted-record, sign-out and broad-read rows', async () => {
    const rows = await servedList('admin', LEDGER, { object_name: OBJ, record_id: id.gone });
    expect(rows.map((r) => r.id).sort()).toEqual([rowIds.goneCreate, rowIds.goneDelete].sort());
    expect(JSON.stringify(rows)).toContain(VALUE.withheld);
    expect(await servedById('admin', rowIds.signOut)).toBe(200);
    expect(await servedById('admin', rowIds.endedSignIn)).toBe(200);
    expect(await servedTotal('admin', { object_name: OBJ })).toBe(await totalAtRest());
  });
});

// ── The declared scope, measured: a holder is bounded by its organization ────
//
// `PLATFORM_CAPABILITIES` declares the capability `scope: 'org'`. That is a
// statement about the runtime: the capability lifts the parent-record gate
// only, so under a wall-enforcing tenancy posture the tenant wall still bounds
// a holder to its own organization's ledger rows. A real `isolated` boot, two
// organizations each created by its owner, each writing and deleting one
// record; the owner of the first holds the capability.

describe('[#21260] the ledger audit capability is bounded by its holder’s organization (scope: org)', () => {
  let stack: VerifyStack;
  let ql: any;
  const tok: Record<'admin' | 'a' | 'b', string> = { admin: '', a: '', b: '' };
  const org: Record<'a' | 'b', string> = { a: '', b: '' };
  const gone: Record<'a' | 'b', string> = { a: '', b: '' };
  const capOnly = PermissionSetSchema.parse({
    name: 'alc_org_auditor', label: 'ALC org auditor', objects: { [LEDGER]: read }, systemPermissions: [CAP],
  });

  const servedAbout = async (who: keyof typeof tok, recordId: string) => {
    const res = await stack.apiAs(tok[who], 'GET', `/data/${LEDGER}?$filter=${filterOf({ object_name: OBJ, record_id: recordId })}`);
    expect(res.status).toBe(200);
    return rowsOf(await res.json()).length;
  };

  beforeAll(async () => {
    stack = await bootStack(fixtureStack as unknown as Parameters<typeof bootStack>[0], {
      security: new SecurityPlugin({ defaultPermissionSets: [...securityDefaultPermissionSets, capOnly] }),
      extraPlugins: [new AuditPlugin()],
      multiTenant: 'posture-only',
    });
    ql = await stack.kernel.getServiceAsync('objectql');
    tok.admin = await stack.signIn();
    for (const who of ['a', 'b'] as const) {
      tok[who] = await stack.signUp(`alc-org-${who}@verify.test`);
      const created = await stack.apiAs(tok[who], 'POST', '/auth/organization/create', { name: `ALC ${who}`, slug: `alc-org-${who}` });
      expect(created.status).toBe(200);
      org[who] = String(((await created.json()) as any).id);
      expect((await stack.apiAs(tok[who], 'POST', '/auth/organization/set-active', { organizationSlug: `alc-org-${who}` })).status).toBe(200);
    }
    const userA = await ql.findOne('sys_user', { where: { email: 'alc-org-a@verify.test' }, context: { ...SYS } });
    const set = await ql.findOne('sys_permission_set', { where: { name: capOnly.name }, context: { ...SYS } });
    await ql.insert('sys_user_permission_set', { user_id: userA.id, permission_set_id: set.id }, { context: { ...SYS } });
    for (const who of ['a', 'b'] as const) {
      const res = await stack.apiAs(tok[who], 'POST', `/data/${OBJ}`, { name: `gone ${who}` });
      expect(res.status).toBeLessThan(300);
      const j = (await res.json()) as any;
      gone[who] = String(j.id ?? j.record?.id);
      expect((await stack.apiAs(tok[who], 'DELETE', `/data/${OBJ}/${gone[who]}`)).status).toBeLessThan(300);
    }

    await assertArmed([
      armedWhen({
        control: 'a real walled posture, two distinct organizations, and each deleted record’s rows stamped with its own organization',
        disarmedBy: 'a single-tenant boot, or rows in one organization, would make the bound below a statement about one tenant',
        observe: async () => {
          const tenancy = await stack.kernel.getServiceAsync<any>('tenancy');
          const orgOf = async (id: string) =>
            [...new Set((await ql.find(LEDGER, { where: { object_name: OBJ, record_id: id }, context: { ...SYS } }))
              .map((r: Row) => r.organization_id))];
          return { posture: tenancy?.posture, active: tenancy?.isolationActive, a: await orgOf(gone.a), b: await orgOf(gone.b) };
        },
        armed: (o) => o.posture === 'isolated' && o.active === true && org.a !== org.b &&
          o.a.length === 1 && o.a[0] === org.a && o.b.length === 1 && o.b[0] === org.b,
        describe: (o) => JSON.stringify(o),
      }),
    ]);
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('holder: is served its own organization’s deleted-record rows, and not another organization’s', async () => {
    expect(await servedAbout('a', gone.a)).toBe(2);
    expect(await servedAbout('a', gone.b)).toBe(0);
  });

  it('non-holder: is served neither', async () => {
    expect(await servedAbout('b', gone.b)).toBe(0);
    expect(await servedAbout('b', gone.a)).toBe(0);
  });

  it('platform administrator: is served both, through its own wall bypass', async () => {
    expect(await servedAbout('admin', gone.a)).toBe(2);
    expect(await servedAbout('admin', gone.b)).toBe(2);
  });
});

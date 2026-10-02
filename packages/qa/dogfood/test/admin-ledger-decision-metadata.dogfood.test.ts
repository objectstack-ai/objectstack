// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The compliance-ledger rows the admin identity endpoints write themselves
// record the admin's DECISIONS and a reference to the user, never a value of a
// field of that user, on a real boot.
//
// ## Why the producer, and not the read side
//
// `plugin-auth` writes its own `sys_audit_log` row for `/admin/create-user`
// and `/admin/set-user-password`, beside the rows plugin-audit's CRUD mirror
// writes for the same calls. The ledger's read side narrows the mirror's
// before/after snapshot columns to what each reader is served. The explicit
// row's `metadata` is free text keyed by decision names, so no read-time
// narrowing can map it back to fields without deriving masking a second time.
// A field value copied there was served to a ledger reader the data plane
// withholds that field from. The fix is at the producer: the row carries the
// decisions and its `object_name` + `record_id` reference, and the values ride
// the mirror's narrowed snapshots.
//
// ## The composition
//
// `bootStack` with the real `SecurityPlugin`, `ObjectQL`, SQL driver, REST and
// auth layers (the admin plugin on, through the SCIM switch that forces it),
// plus `AuditPlugin`. The platform declares no mask and no capability gate on
// the user fields these endpoints write, so the fixture layers them the way an
// app does, through an object extension (a field the target already declares
// is replaced): one written field per class.
//
//   - MASKED: a `maskingRule` whose unmask gate is one capability;
//   - CAPABILITY-GATED: `requiredPermissions` naming another, no mask;
//   - NOT GRANTED: plain, and marked non-readable by a set the reader holds.
//
// One reader per class holds exactly what makes ITS class apply; the control
// holds both capabilities and no withholding set. A wildcard reader takes its
// ledger read from the platform read-only set beside a withholding set, with
// no capability, so every class applies to it. The seeded platform admin
// creates one user and then resets its password, so both explicit rows exist.
//
// Every reader can also OPEN that user through the data door. The ledger's
// parent-record read gate (`audit-log-read-visibility.ts`) serves a row about a
// record only to a caller who can read that record, and a member reads only its
// own user row by default. So each reader's sets add view-all on `sys_user` —
// a row-scope grant, not a field one: the classes above still apply, which the
// armed check below measures — and a reader who could not open the subject
// would be served none of its rows, so the classes would measure nothing.
//
// ## What is asserted
//
// - `beforeAll` (`assertArmed`): both explicit rows exist at rest, and the
//   mirror rows at rest carry every class; every reader opens the subject
//   through the data door; the mirror rows served to each
//   reader withhold exactly its class (the security service's own answer is
//   engaged for it), and the control is served every class.
// - Per class, through the list door, the by-id door and a list projected to
//   the metadata and snapshot columns: both explicit rows are served to the
//   reader, and no row served to it carries a value of its class. The other
//   two classes still reach it through the mirror's snapshots.
// - The control is served every class through the mirror's snapshots, and the
//   explicit rows carry the closed decision set and nothing else.
//
// Fixtures are synthetic. ⚠️ No test title states a value.
// `@objectstack/plugin-auth` and `@objectstack/plugin-audit` resolve through
// their BUILT output here (ledgered pairs in `scripts/check-test-source-alias.mjs`),
// so a verdict on a change to either is a verdict on its last build.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { assertArmed, armedWhen } from './armed.js';

const LEDGER = 'sys_audit_log';
const USER = 'sys_user';
const CAP_UNMASK = 'ald_unmask';
const CAP_READ = 'ald_read_gated';
const SYS = { context: { isSystem: true } } as const;

type ClassName = 'masked' | 'gated' | 'withheld';
const CLASSES: ClassName[] = ['masked', 'gated', 'withheld'];
/** The user field the endpoints write that carries each class in this fixture. */
const FIELD: Record<ClassName, string> = { masked: 'role', gated: 'must_change_password', withheld: 'email' };
/** Synthetic values the admin writes. The gated field is a flag, so it is detected by its key. */
const SUBJECT = { email: 'ald.subject.kq@example.com', name: 'Ald Subject', role: 'aldrolekq' };
const VALUE: Record<ClassName, string | null> = { masked: SUBJECT.role, gated: null, withheld: SUBJECT.email };

/** The explicit rows' events, and the decision keys each may carry. */
const CREATE_EVENT = 'user.admin_created';
const PASSWORD_SET_EVENT = 'user.admin_password_set';
const DECISIONS: Record<string, { required: string[]; optional: string[] }> = {
  [CREATE_EVENT]: { required: ['event', 'membershipCreated', 'passwordGenerated', 'placeholderEmail'], optional: ['organizationId'] },
  [PASSWORD_SET_EVENT]: { required: ['event', 'passwordGenerated'], optional: [] },
};

const Anchor = ObjectSchema.create({
  name: 'ald_anchor',
  label: 'ALD Anchor',
  pluralLabel: 'ALD Anchors',
  fields: { name: Field.text({ label: 'Name' }) },
});

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.admin-ledger-decision-metadata',
    namespace: 'ald',
    version: '0.0.0',
    type: 'app',
    name: 'Admin Ledger Decision Metadata Fixture',
    description: 'Layers a masked and a capability-gated class over two user fields the admin endpoints write.',
  },
  objects: [Anchor],
  objectExtensions: [
    {
      extend: USER,
      fields: {
        role: Field.text({
          label: 'Platform Role',
          readonly: true,
          maxLength: 64,
          maskingRule: { keepHead: 1, keepTail: 1 },
          requiredPermissions: [CAP_UNMASK],
        }),
        must_change_password: Field.boolean({
          label: 'Must Change Password',
          defaultValue: false,
          readonly: true,
          requiredPermissions: [CAP_READ],
        }),
      },
    },
  ],
});

const read = { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false };
/** View-all on the user object: the subject's ledger rows reach only a reader who can open the subject. */
const grants = { [USER]: { ...read, viewAllRecords: true }, [LEDGER]: read };
const withheldField = { [`${USER}.${FIELD.withheld}`]: { readable: false, editable: false } };
/**
 * The masked and gated classes ride two fields of the identity object's `Admin` group, which the
 * platform baseline (`member_default`) withholds from every reader holding no admin set (#21237).
 * The readers' own sets grant them back, the way an app that means its readers to see them does,
 * so each class applies only through its own mechanism.
 */
const classFieldsReadable = {
  [`${USER}.${FIELD.masked}`]: { readable: true, editable: false },
  [`${USER}.${FIELD.gated}`]: { readable: true, editable: false },
};
const unmaskSet = PermissionSetSchema.parse({ name: 'ald_unmask_set', label: 'ALD unmask', objects: grants, fields: classFieldsReadable, systemPermissions: [CAP_UNMASK] });
const gatedReadSet = PermissionSetSchema.parse({ name: 'ald_gated_read_set', label: 'ALD gated read', objects: grants, fields: classFieldsReadable, systemPermissions: [CAP_READ] });
const withholdSet = PermissionSetSchema.parse({ name: 'ald_withhold_set', label: 'ALD withhold', objects: grants, fields: { ...classFieldsReadable, ...withheldField } });
/** Withholds the field and grants only view-all on the user object: beside the platform read-only set, which grants the ledger read. */
const withholdOnlySet = PermissionSetSchema.parse({
  name: 'ald_withhold_only_set',
  label: 'ALD withhold only',
  objects: { [USER]: { allowRead: true, viewAllRecords: true } },
  fields: withheldField,
});

/** Each reader, and the sets that make exactly its class apply. */
const READERS: Record<ClassName | 'control' | 'wildcard', string[]> = {
  masked: [gatedReadSet.name],
  gated: [unmaskSet.name],
  withheld: [unmaskSet.name, gatedReadSet.name, withholdSet.name],
  control: [unmaskSet.name, gatedReadSet.name],
  wildcard: ['viewer_readonly', withholdOnlySet.name],
};
type Reader = keyof typeof READERS;

type Row = Record<string, any>;
const rowsOf = (body: any): Row[] => body?.records ?? body?.data ?? (Array.isArray(body) ? body : []);
const recordOf = (body: any): Row => body?.record ?? body;

/** A camelCase decision key and a snake_case field name compare equal. */
const norm = (k: string): string => k.replace(/_/g, '').toLowerCase();

function keysDeep(value: unknown, out: string[] = []): string[] {
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.push(k);
      keysDeep(v, out);
    }
  }
  return out;
}

/** Does one stored column carry a value of the class — its value, or a key naming its field? */
function columnCarries(text: unknown, c: ClassName): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  const value = VALUE[c];
  if (value !== null && text.includes(value)) return true;
  try {
    return keysDeep(JSON.parse(text)).some((k) => norm(k) === norm(FIELD[c]));
  } catch {
    return false;
  }
}

const rowCarries = (row: Row, c: ClassName): boolean =>
  columnCarries(row.metadata, c) || columnCarries(row.old_value, c) || columnCarries(row.new_value, c);

const eventOf = (row: Row): string | null => {
  try {
    return typeof row.metadata === 'string' ? (JSON.parse(row.metadata)?.event ?? null) : null;
  } catch {
    return null;
  }
};
const isExplicit = (row: Row): boolean => eventOf(row) !== null;
const isMirror = (row: Row): boolean => row.metadata == null && (row.action === 'create' || row.action === 'update');

describe('the admin identity rows on the compliance ledger carry decisions, never a value of a user field', () => {
  let stack: VerifyStack;
  let ql: any;
  let priorScim: string | undefined;
  let subjectId = '';
  const token: Record<string, string> = {};

  const filter = () => encodeURIComponent(JSON.stringify({ object_name: USER, record_id: subjectId }));

  /** Every ledger row about the subject a reader is served, through three doors. */
  const servedRows = async (who: Reader) => {
    const doors: Record<'list' | 'byId' | 'projected', Row[]> = { list: [], byId: [], projected: [] };
    const list = await stack.apiAs(token[who], 'GET', `/data/${LEDGER}?$filter=${filter()}`);
    expect(list.status).toBe(200);
    doors.list = rowsOf(await list.json());
    for (const row of doors.list) {
      const res = await stack.apiAs(token[who], 'GET', `/data/${LEDGER}/${row.id}`);
      expect(res.status).toBe(200);
      doors.byId.push(recordOf(await res.json()));
    }
    const projected = await stack.apiAs(
      token[who],
      'GET',
      `/data/${LEDGER}?$filter=${filter()}&$select=id,metadata,old_value,new_value`,
    );
    expect(projected.status).toBe(200);
    doors.projected = rowsOf(await projected.json());
    return doors;
  };

  const ledgerAtRest = async (): Promise<Row[]> =>
    ql.find(LEDGER, { where: { object_name: USER, record_id: subjectId }, context: { isSystem: true } });

  beforeAll(async () => {
    priorScim = process.env.OS_SCIM_ENABLED;
    process.env.OS_SCIM_ENABLED = 'true';
    stack = await bootStack(fixtureStack as unknown as Parameters<typeof bootStack>[0], {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, unmaskSet, gatedReadSet, withholdSet, withholdOnlySet],
      }),
      extraPlugins: [new AuditPlugin()],
    });
    ql = await stack.kernel.getServiceAsync('objectql');
    const idOf = async (object: string, where: Record<string, unknown>) =>
      String((await ql.findOne(object, { where, context: { isSystem: true } }))?.id ?? '');

    // The seeded platform admin signs in first, so no reader can be the first
    // account on the deployment.
    const admin = await stack.signIn();
    for (const who of Object.keys(READERS) as Reader[]) {
      const email = `ald-${who}@verify.test`;
      token[who] = await stack.signUp(email);
      const userId = await idOf(USER, { email });
      for (const name of READERS[who]) {
        const setId = await idOf('sys_permission_set', { name });
        expect(setId, `fixture permission set ${name} seeded`).toBeTruthy();
        await ql.insert('sys_user_permission_set', { user_id: userId, permission_set_id: setId }, SYS);
      }
    }

    // The admin drives both endpoints through their HTTP doors.
    const created = await stack.apiAs(admin, 'POST', '/auth/admin/create-user', {
      ...SUBJECT,
      password: 'Ald!Subject12345',
    });
    expect(created.status, await created.clone().text()).toBe(200);
    subjectId = String((await created.json()).data.user.id);
    const reset = await stack.apiAs(admin, 'POST', '/auth/admin/set-user-password', {
      userId: subjectId,
      newPassword: 'Ald!Rotated67890',
    });
    expect(reset.status, await reset.clone().text()).toBe(200);

    // The mirror's rows can settle after the response; wait until every row is down.
    for (let i = 0; i < 40; i++) {
      const rows = await ledgerAtRest();
      const events = rows.map(eventOf);
      if (events.includes(CREATE_EVENT) && events.includes(PASSWORD_SET_EVENT) &&
          CLASSES.every((c) => rows.filter(isMirror).some((r) => rowCarries(r, c)))) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    await assertArmed([
      armedWhen({
        control: 'both explicit rows exist at rest, and the mirror rows at rest carry every class',
        disarmedBy: 'a missing explicit row would let every negative case pass on a row that was never written, and a mirror that stopped carrying a class would hide where the value went',
        observe: async () => {
          const rows = await ledgerAtRest();
          return {
            events: rows.map(eventOf).filter((e): e is string => e !== null).sort(),
            mirrorCarries: CLASSES.filter((c) => rows.filter(isMirror).some((r) => rowCarries(r, c))),
          };
        },
        armed: (o) => o.events.includes(CREATE_EVENT) && o.events.includes(PASSWORD_SET_EVENT) && o.mirrorCarries.length === 3,
        describe: (o) => `events: ${o.events.join(',') || 'none'}; mirror carries: ${o.mirrorCarries.join(',') || 'none'}`,
      }),
      armedWhen({
        control: 'every reader opens the subject user through the data door',
        disarmedBy: 'the ledger serves a row about a record only to a caller who can read that record, so a reader who could not open the subject would be served none of its rows and every class case below would measure an empty list',
        observe: async () => {
          const status: Record<string, number> = {};
          for (const who of Object.keys(READERS) as Reader[]) {
            status[who] = (await stack.apiAs(token[who], 'GET', `/data/${USER}/${subjectId}`)).status;
          }
          return status;
        },
        armed: (o) => Object.values(o).every((s) => s === 200),
        describe: (o) => JSON.stringify(o),
      }),
      armedWhen({
        control: 'the mirror rows served to each reader withhold exactly its class, and the control is served every class',
        disarmedBy: 'a reader whose grants did not resolve would be served every value, and its negative cases would measure an unrestricted reader',
        observe: async () => {
          const served: Record<string, ClassName[]> = {};
          for (const who of Object.keys(READERS) as Reader[]) {
            const { list } = await servedRows(who);
            served[who] = CLASSES.filter((c) => list.filter(isMirror).some((r) => rowCarries(r, c)));
          }
          return served;
        },
        armed: (o) =>
          CLASSES.every((c) => !o[c].includes(c) && CLASSES.filter((x) => x !== c).every((x) => o[c].includes(x))) &&
          o.control.length === 3 &&
          o.wildcard.length === 0,
        describe: (o) => JSON.stringify(o),
      }),
    ]);
  }, 240_000);

  afterAll(async () => {
    if (stack) await stack.stop();
    if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED;
    else process.env.OS_SCIM_ENABLED = priorScim;
  });

  for (const c of CLASSES) {
    it(`${c}: both explicit rows are served to the reader, and no row served to it carries a value of its class, through any door`, async () => {
      const doors = await servedRows(c);
      for (const [door, rows] of Object.entries(doors)) {
        const events = rows.map(eventOf);
        expect(events, `${door}: the explicit rows are served`).toContain(CREATE_EVENT);
        expect(events, `${door}: the explicit rows are served`).toContain(PASSWORD_SET_EVENT);
        for (const row of rows) {
          expect(rowCarries(row, c), `${door}: a ${eventOf(row) ?? row.action} row carries the ${c} class`).toBe(false);
        }
      }
    });

    it(`${c}: the two other classes still reach the reader, through the mirror's snapshots`, async () => {
      const { list } = await servedRows(c);
      for (const other of CLASSES.filter((o) => o !== c)) {
        expect(list.filter(isMirror).some((r) => rowCarries(r, other)), `the ${other} class`).toBe(true);
      }
    });
  }

  it('wildcard: a reader granted the ledger by the platform read-only set is served no value of any class, through any door', async () => {
    const doors = await servedRows('wildcard');
    for (const [door, rows] of Object.entries(doors)) {
      expect(rows.filter(isExplicit).length, `${door}: the explicit rows are served`).toBe(2);
      for (const row of rows) {
        for (const c of CLASSES) expect(rowCarries(row, c), `${door}: the ${c} class`).toBe(false);
      }
    }
  });

  it('control: every class reaches the unmasking reader through the mirror, and the explicit rows carry only the closed decision set', async () => {
    const doors = await servedRows('control');
    for (const c of CLASSES) {
      expect(doors.list.filter(isMirror).some((r) => rowCarries(r, c)), `the ${c} class`).toBe(true);
    }
    for (const [door, rows] of Object.entries(doors)) {
      const explicit = rows.filter(isExplicit);
      expect(explicit.length, `${door}: the explicit rows are served`).toBe(2);
      for (const row of explicit) {
        const allowed = DECISIONS[eventOf(row) as string];
        expect(allowed, `${door}: a known event`).toBeTruthy();
        const keys = Object.keys(JSON.parse(row.metadata));
        for (const k of allowed.required) expect(keys, `${door}: the ${k} decision`).toContain(k);
        for (const k of keys) expect([...allowed.required, ...allowed.optional], `${door}: an undeclared key`).toContain(k);
        // The reference to the record is the row's own columns (not projected on the third door).
        if (door !== 'projected') {
          expect(row.object_name).toBe(USER);
          expect(row.record_id).toBe(subjectId);
        }
      }
    }
  });
});

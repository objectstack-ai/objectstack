// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0139 E6] The activity stream's withheld-row rule is a predicate over
// two writer-stamped columns, with no SYSTEM pre-scan and no window, on a real
// boot at the HTTP door.
//
// ## What changed
//
// The rule withholds, from a reader, an update row whose every recorded key it
// is not served (#21388) and a fired milestone row whose watched fields it is
// not all served (#22786). It used to be a WHERE built from a SYSTEM pre-scan
// of at most 2,000 rows, which capped every broad read of the stream: a
// member was served 725 of the 1,816 rows it may read, and an administrator's
// site-wide total read 1,999. It is now a predicate over `changed_fields` and
// `milestone_key`, which every writer stamps (`activity-changed-fields.ts`).
//
// ## The composition
//
// `bootStack` with the real `SecurityPlugin`, `ObjectQL`, SQL driver, REST and
// auth layers, plus `AuditPlugin`. A member owns one private record and is
// withheld one of its fields; a writer owns another the member cannot open.
// The store holds more than twice the old window: a bulk of activity rows
// about the two records, inserted as the system (the before-insert hook stamps
// them, as it stamps any writer's row), some of them updates of the withheld
// field only.
//
// `@objectstack/plugin-audit` resolves through its BUILT output here.
// Fixtures are synthetic. ⚠️ No test title states a value.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { assertArmed, armedWhen } from './armed.js';
import { catalogPermissionSet } from './catalog-permission-set.js';

const ACTIVITY = 'sys_activity';
const OBJ = 'awp_item';
const SYS = { isSystem: true } as const;
/** The old pre-scan window. */
const OLD_WINDOW = 2_000;
/** Rows about the member's record: served to it whole. */
const SERVED_BULK = 2_050;
/** Rows about the member's record that change only the withheld field. */
const WITHHELD_BULK = 50;
/** Rows about the writer's record, which the member cannot open. */
const OTHER_BULK = 2_101;
const PASSWORD = 'Awp-Fixture-Pass-23731';

const Item = ObjectSchema.create({
  name: OBJ,
  label: 'AWP Item',
  pluralLabel: 'AWP Items',
  // sharingModel omitted: a custom object defaults to private (ADR-0090).
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    awp_open: Field.text({ label: 'Open' }),
    awp_secret: Field.text({ label: 'Secret' }),
  },
});

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.activity-withheld-row-predicate',
    namespace: 'awp',
    version: '0.0.0',
    type: 'app',
    name: 'Activity Withheld Row Predicate Fixture',
    description: 'One private object whose activity rows a member and an administrator read past the old pre-scan window.',
  },
  objects: [Item],
});

const read = { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false };
const write = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
const baselineSet = PermissionSetSchema.parse({
  name: 'awp_baseline',
  label: 'AWP baseline',
  objects: { [OBJ]: write, [ACTIVITY]: read },
});
const withholdSet = PermissionSetSchema.parse({
  name: 'awp_withhold',
  label: 'AWP withhold',
  objects: {},
  fields: { [`${OBJ}.awp_secret`]: { readable: false, editable: false } },
});

type Row = Record<string, any>;
const rowsOf = (body: any): Row[] => body?.records ?? body?.data ?? (Array.isArray(body) ? body : []);
const filterOf = (where: Record<string, unknown>) => encodeURIComponent(JSON.stringify(where));

describe('[ADR-0139 E6] the withheld-row rule is a predicate: every row a reader may read, past the old window', () => {
  let stack: VerifyStack;
  let ql: any;
  const token = { admin: '', member: '', writer: '' };
  const id = { mine: '', other: '' };
  /** The bulk row ids, by class. */
  const bulk = { served: [] as string[], withheld: [] as string[], other: [] as string[] };
  /** Every read of the activity stream, with whether it ran as the system. */
  const activityReads: Array<{ method: string; system: boolean; fields: string }> = [];

  const list = async (who: keyof typeof token, query: string) => {
    const res = await stack.apiAs(token[who], 'GET', `/data/${ACTIVITY}?${query}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    return { rows: rowsOf(body), total: Number(body.total) };
  };
  /** Walk a list a page at a time: the ids served, and the total each page reported. */
  const walk = async (who: keyof typeof token, where: Record<string, unknown>) => {
    const ids: string[] = [];
    const totals = new Set<number>();
    for (let skip = 0; skip < 10_000; skip += 500) {
      const page = await list(who, `$filter=${filterOf(where)}&$orderby=id&$top=500&$skip=${skip}`);
      totals.add(page.total);
      ids.push(...page.rows.map((r) => String(r.id)));
      if (page.rows.length < 500) break;
    }
    return { ids, totals: [...totals] };
  };

  beforeAll(async () => {
    stack = await bootStack(fixtureStack as unknown as Parameters<typeof bootStack>[0], {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, baselineSet, withholdSet],
        fallbackPermissionSet: baselineSet.name,
      }),
      extraPlugins: [new AuditPlugin()],
    });
    ql = await stack.kernel.getServiceAsync('objectql');
    token.admin = await stack.signIn();
    const userIdOf = async (email: string) =>
      String((await ql.findOne('sys_user', { where: { email }, context: { ...SYS } }))?.id ?? '');
    const grant = async (email: string, setName: string) => {
      const set = await catalogPermissionSet(ql, setName);
      expect(set, `fixture permission set ${setName} served by the security catalog`).toBeTruthy();
      await ql.insert('sys_user_permission_set', { user_id: await userIdOf(email), permission_set: set.name }, { context: { ...SYS } });
    };
    for (const who of ['member', 'writer'] as const) {
      const email = `awp-${who}@verify.test`;
      token[who] = await stack.signUp(email, PASSWORD);
      await grant(email, baselineSet.name);
    }
    await grant('awp-member@verify.test', withholdSet.name);

    const idOf = async (res: Response) => {
      expect(res.status, 'fixture write').toBeLessThan(300);
      const j = (await res.json()) as any;
      return String(j.id ?? j.record?.id ?? j.data?.id);
    };
    id.mine = await idOf(await stack.apiAs(token.member, 'POST', `/data/${OBJ}`, { name: 'mine' }));
    id.other = await idOf(await stack.apiAs(token.writer, 'POST', `/data/${OBJ}`, { name: 'other' }));

    // The bulk, newest last, inserted as the system: the before-insert hook
    // stamps each row from its recorded change.
    const base = Date.now();
    let n = 0;
    const plant = async (recordId: string, key: string) => {
      n += 1;
      const row = await ql.insert(ACTIVITY, {
        type: 'updated', summary: `bulk ${n}`, object_name: OBJ, record_id: recordId,
        timestamp: new Date(base + n * 1_000).toISOString(),
        metadata: JSON.stringify({ old: { [key]: `a${n}` }, new: { [key]: `b${n}` } }),
      }, { context: { ...SYS } });
      return String(row.id);
    };
    for (let i = 0; i < SERVED_BULK; i++) bulk.served.push(await plant(id.mine, 'awp_open'));
    for (let i = 0; i < WITHHELD_BULK; i++) bulk.withheld.push(await plant(id.mine, 'awp_secret'));
    for (let i = 0; i < OTHER_BULK; i++) bulk.other.push(await plant(id.other, 'awp_open'));

    // Every read of the stream from here on, by context.
    for (const method of ['find', 'findOne', 'count', 'aggregate'] as const) {
      const original = ql[method].bind(ql);
      vi.spyOn(ql, method).mockImplementation(async (...args: any[]) => {
        if (args[0] === ACTIVITY) {
          const ctx = args[1]?.context ?? args[2]?.context;
          activityReads.push({ method, system: ctx?.isSystem === true, fields: JSON.stringify(args[1]?.fields ?? null) });
        }
        return original(...args);
      });
    }

    await assertArmed([
      armedWhen({
        control: 'the store holds more than twice the old window, and each bulk row carries the stamp of its recorded change',
        disarmedBy: 'a store inside the window, or rows the hook did not stamp, would let every case below pass on a capped or fail-closed read',
        observe: async () => {
          const atRest: Row[] = await ql.find(ACTIVITY, { where: { object_name: OBJ }, limit: 10_000, context: { ...SYS } });
          const byId = new Map(atRest.map((r) => [String(r.id), r]));
          return {
            atRest: atRest.length,
            served: JSON.stringify(byId.get(bulk.served[0])?.changed_fields),
            withheld: JSON.stringify(byId.get(bulk.withheld[0])?.changed_fields),
          };
        },
        armed: (o) => o.atRest > 2 * OLD_WINDOW && o.served === '["awp_open"]' && o.withheld === '["awp_secret"]',
        describe: (o) => JSON.stringify(o),
      }),
      armedWhen({
        control: 'the member opens its own record and not the writer’s, and is withheld the one field',
        disarmedBy: 'a member who could open the writer’s record, or read the field, would make the withheld cases below measure nothing',
        observe: async () => {
          const mine = (await (await stack.apiAs(token.member, 'GET', `/data/${OBJ}/${id.mine}`)).json()) as any;
          return {
            mine: 'name' in (mine?.record ?? mine ?? {}),
            secretServed: 'awp_secret' in (mine?.record ?? mine ?? {}),
            other: (await stack.apiAs(token.member, 'GET', `/data/${OBJ}/${id.other}`)).status,
          };
        },
        armed: (o) => o.mine && !o.secretServed && (o.other === 404 || o.other === 403),
        describe: (o) => JSON.stringify(o),
      }),
    ]);
  }, 600_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await stack?.stop();
  });

  it('a member is served every activity row it may read, past the old window, and every page reports that total', async () => {
    const atRest: Row[] = await ql.find(ACTIVITY, { where: { object_name: OBJ, record_id: id.mine }, limit: 10_000, context: { ...SYS } });
    const withheld = new Set(bulk.withheld);
    const expected = atRest.map((r) => String(r.id)).filter((rowId) => !withheld.has(rowId)).sort();
    expect(expected.length).toBeGreaterThan(OLD_WINDOW);
    const { ids, totals } = await walk('member', { object_name: OBJ });
    expect([...ids].sort()).toEqual(expected);
    expect(totals).toEqual([expected.length]);
  });

  it('the member is served no update row whose every recorded key it is withheld, and no row about a record it cannot open', async () => {
    const { ids } = await walk('member', { object_name: OBJ });
    const served = new Set(ids);
    expect(bulk.withheld.filter((rowId) => served.has(rowId))).toEqual([]);
    expect(bulk.other.filter((rowId) => served.has(rowId))).toEqual([]);
  });

  it('an administrator’s site-wide read (newest first, 20) is served the 20 newest rows and a total past the old window', async () => {
    const { rows, total } = await list('admin', '$orderby=timestamp%20desc&$top=20');
    expect(rows.map((r) => String(r.id))).toEqual([...bulk.other].reverse().slice(0, 20));
    const fixture = (await list('admin', `$filter=${filterOf({ object_name: OBJ })}&$top=1`)).total;
    const rest = (await list('admin', `$filter=${filterOf({ object_name: { $ne: OBJ } })}&$top=1`)).total;
    // Every bulk row, every mirror row about the two records: nothing withheld from the administrator.
    expect(fixture).toBe(SERVED_BULK + WITHHELD_BULK + OTHER_BULK + 2);
    expect(total).toBe(fixture + rest);
    expect(total).toBeGreaterThan(2 * OLD_WINDOW);
  });

  it('no read of the activity stream runs as the system while a member or an administrator is served it', async () => {
    activityReads.length = 0;
    await list('member', `$filter=${filterOf({ object_name: OBJ })}&$top=20`);
    await list('admin', '$orderby=timestamp%20desc&$top=20');
    expect(activityReads.length).toBeGreaterThan(0);
    expect(activityReads.filter((r) => r.system)).toEqual([]);
  });
});

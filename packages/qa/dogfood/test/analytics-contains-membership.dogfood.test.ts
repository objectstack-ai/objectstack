// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// END-TO-END gate for #20987: an analytics answer counts the rows a row-level
// policy admits when the policy (or the query's own `where`) asks `$contains`
// of a multi-valued field, through the REAL stack: HTTP -> REST execution
// context -> SecurityPlugin row policy -> the AnalyticsServicePlugin's
// `getReadScope` auto-bridge -> the NativeSQL strategy on SQLite, and the
// ObjectQL strategy (native SQL withheld; see `DRIVERS`).
//
// ## The defect
//
// The contract (`FILTER_OPERATORS.$contains`, `@objectstack/spec/data`) makes
// `$contains` on a multi-valued or JSON-stored field a MEMBERSHIP test, and the
// data door answers it that way. The analytics read scope and the native
// analytics `where` compiled it as a substring test over the stored JSON text,
// so on SQLite a row storing `["u10"]` satisfied a policy written to admit the
// rows holding `u1`: the member's analytics count included a row outside the
// policy. The `where` over-counted the same way, and its complement
// under-counted.
//
// ## How it is observed
//
// The policy is authored in the policy language (`tags.contains('u1')`, which
// lowers to `$contains`), on a member permission set. The member's own read of
// the object through the data door is the truth; the member's analytics count
// must equal it. The scalar-text twin of the policy is the control: on a text
// column `$contains` stays the substring test, so there the row storing `u10`
// IS admitted, on both doors.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AnalyticsServicePlugin } from '@objectstack/service-analytics';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

/** A multi-valued field under a membership policy. */
const MbrTagged = ObjectSchema.create({
  name: 'mbr_tagged',
  // [ADR-0090 D1] grandfather stamp: the gate under test is permission-set RLS.
  sharingModel: 'public_read_write',
  label: 'Membership Tagged',
  pluralLabel: 'Membership Tagged',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    tags: { type: 'tags', label: 'Tags' },
  },
});

/** The scalar control: the same policy shape over a text column. */
const MbrLabelled = ObjectSchema.create({
  name: 'mbr_labelled',
  sharingModel: 'public_read_write',
  label: 'Membership Labelled',
  pluralLabel: 'Membership Labelled',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    label: Field.text({ label: 'Label' }),
  },
});

/** No row policy: the object the `where` legs run on, so only the `where` decides. */
const MbrOpen = ObjectSchema.create({
  name: 'mbr_open',
  sharingModel: 'public_read_write',
  label: 'Membership Open',
  pluralLabel: 'Membership Open',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    tags: { type: 'tags', label: 'Tags' },
    label: Field.text({ label: 'Label' }),
  },
});

const membershipStack = defineStack({
  manifest: {
    id: 'com.dogfood.analytics-contains-membership',
    namespace: 'mbr',
    version: '0.0.0',
    type: 'app',
    name: 'Analytics Contains Membership Fixture',
    description: 'A multi-valued field and a text field, each under a $contains row policy, and an object with none.',
  },
  objects: [MbrTagged, MbrLabelled, MbrOpen],
});

const memberSet: PermissionSet = PermissionSetSchema.parse({
  name: 'mbr_fixture_member',
  label: 'Membership fixture member',
  objects: {
    mbr_tagged: { allowRead: true },
    mbr_labelled: { allowRead: true },
    mbr_open: { allowRead: true },
  },
  rowLevelSecurity: [
    { name: 'mbr_tagged_holds_u1', label: 'Tagged u1', object: 'mbr_tagged', operation: 'select', using: "tags.contains('u1')", enabled: true },
    { name: 'mbr_labelled_holds_u1', label: 'Labelled u1', object: 'mbr_labelled', operation: 'select', using: "label.contains('u1')", enabled: true },
  ],
});

/** The card's fixture is `t2`: it stores `["u10"]`. `t4` stores no tags. */
const TAGGED = [
  { name: 't1', tags: ['u1', 'u2'] },
  { name: 't2', tags: ['u10'] },
  { name: 't3', tags: ['u2'] },
  { name: 't4' },
];
const LABELLED = [
  { name: 'l1', label: 'u1' },
  { name: 'l2', label: 'u10' },
  { name: 'l3', label: 'u2' },
];
const OPEN = [
  { name: 'o1', tags: ['u1', 'u2'], label: 'u1' },
  { name: 'o2', tags: ['u10'], label: 'u10' },
  { name: 'o3', tags: ['u2'], label: 'u2' },
  { name: 'o4' },
];

/**
 * [ADR-0131 C1] The two analytics strategies, each on the SQL in-memory driver
 * (`sqlite-wasm`, `:memory:`): the `sqlite-wasm` leg lets the analytics plugin
 * take its NativeSQL strategy, and the `objectql-strategy` leg withholds the
 * native-SQL capability (`queryCapabilities`) so the ObjectQL strategy answers.
 * That leg used to be the in-memory driver, whose only route to the ObjectQL
 * strategy was having no SQL. Under `single` every session now carries the
 * Default Organization, and `driver-memory` refuses a tenant-scoped read (503)
 * until ADR-0131 D8 gives `single` no read predicate.
 * Restart-when: #15212 closed — add the `memory` leg back then.
 */
const DRIVERS = ['sqlite-wasm', 'objectql-strategy'] as const;

/** The analytics plugin a leg boots; the ObjectQL-strategy leg withholds native SQL. */
function analyticsFor(
  leg: (typeof DRIVERS)[number],
  options: ConstructorParameters<typeof AnalyticsServicePlugin>[0] = {},
): AnalyticsServicePlugin {
  return new AnalyticsServicePlugin({
    ...options,
    ...(leg === 'objectql-strategy'
      ? { queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }) }
      : {}),
  });
}

/** The single count a one-measure answer carries, whichever envelope the door uses. */
function countOf(body: unknown, measure: string): number {
  const payload = (body as { data?: unknown })?.data ?? body;
  const rows = (payload as { rows?: Array<Record<string, unknown>> })?.rows ?? [];
  return rows.reduce((sum, row) => sum + Number(row[measure] ?? 0), 0);
}

describe.each(DRIVERS)('dogfood: analytics counts a $contains policy on a multi-valued field by membership (#20987) [driver=%s]', (driver) => {
  let stack: VerifyStack;
  let adminToken: string;
  let memberToken: string;

  beforeAll(async () => {
    stack = await bootStack(membershipStack as never, {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, memberSet],
        fallbackPermissionSet: memberSet.name,
      }),
      databaseDriver: 'sqlite-wasm',
      analytics: analyticsFor(driver),
    });
    adminToken = await stack.signIn();
    memberToken = await stack.signUp(`mbr-member-${driver}@verify.test`);
    for (const row of TAGGED) {
      const r = await stack.apiAs(adminToken, 'POST', '/data/mbr_tagged', row);
      expect(r.status, await r.clone().text()).toBeLessThan(300);
    }
    for (const row of LABELLED) {
      const r = await stack.apiAs(adminToken, 'POST', '/data/mbr_labelled', row);
      expect(r.status, await r.clone().text()).toBeLessThan(300);
    }
    for (const row of OPEN) {
      const r = await stack.apiAs(adminToken, 'POST', '/data/mbr_open', row);
      expect(r.status, await r.clone().text()).toBeLessThan(300);
    }
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  /** The caller's own rows through the data door: the policy's truth. */
  async function namesFor(token: string, object: string): Promise<string[]> {
    const res = await stack.apiAs(token, 'GET', `/data/${object}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { records?: Array<{ name: string }> };
    return (body.records ?? []).map((r) => r.name).sort();
  }

  /** The caller's analytics count of `object`, optionally under a `where`. */
  async function countFor(token: string, object: string, where?: unknown): Promise<number> {
    const res = await stack.apiAs(token, 'POST', '/analytics/query', {
      cube: object,
      measures: ['count'],
      ...(where ? { where } : {}),
    });
    const text = await res.text();
    expect(res.status, text).toBe(200);
    return countOf(JSON.parse(text), 'count');
  }

  it('premise: the policy admits only the row holding the member through the data door, and the other rows exist', async () => {
    expect(await namesFor(memberToken, 'mbr_tagged')).toEqual(['t1']);
    // Ground truth under a system context: every row was stored.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    const all = (await ql.find('mbr_tagged', { context: { isSystem: true } })) as Array<{ name: string }>;
    expect(all.map((r) => r.name).sort()).toEqual(['t1', 't2', 't3', 't4']);
  });

  it("the member's analytics count equals the policy: the row storing [\"u10\"] is not admitted", async () => {
    expect(await countFor(memberToken, 'mbr_tagged')).toBe(1);
  });

  it('CONTROL: on a text column the policy stays a substring test, and both doors admit the row storing u10', async () => {
    expect(await namesFor(memberToken, 'mbr_labelled')).toEqual(['l1', 'l2']);
    expect(await countFor(memberToken, 'mbr_labelled')).toBe(2);
  });

  it("the where's $contains counts members, and $notContains counts the complement, the row with no tags included", async () => {
    expect(await namesFor(memberToken, 'mbr_open')).toEqual(['o1', 'o2', 'o3', 'o4']);
    expect(await countFor(memberToken, 'mbr_open', { tags: { $contains: 'u1' } })).toBe(1);
    expect(await countFor(memberToken, 'mbr_open', { tags: { $notContains: 'u1' } })).toBe(3);
  });

  it("CONTROL: the where's $contains on a text column stays a substring test", async () => {
    expect(await countFor(memberToken, 'mbr_open', { label: { $contains: 'u1' } })).toBe(2);
  });
});

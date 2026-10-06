// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// END-TO-END: with the optional pinyin search companion ON, a member's search
// answers only what the member may see — the rows their row scope admits, and
// matches on the fields they may query.
//
// ## What this boot pins
//
// A real kernel with the real `SecurityPlugin` and the real
// `PinyinSearchPlugin`, over HTTP. Every row is named in CJK, so a pinyin term
// can match it only through the `__search` companion — never through the
// source column.
//
//   - ROW-SCOPED: on a `private` object both the member and the administrator
//     own a row matching the term. The member's search answers the member's
//     own row only; the administrator gets both.
//   - FIELD HIDDEN FROM THE MEMBER: the member's permission set hides `name`
//     on a second object, and the term is present only in that field. The
//     member's search yields no hit — through the global search door and
//     through a `searchFields`-narrowed data-door query. A field-narrowed
//     search does not match through the companion of a field outside its
//     search-field set (`objectql` `expandSearchToFilter`).
//
// Controls keep both "no hit" readings from being vacuous: the administrator's
// search DOES hit through the companion (so the companion is provisioned and
// filled in this boot, and a search with no narrowing keeps it), and the member
// DOES hit the same row through a field they may query (so the object itself is
// searched, not skipped).
//
// Env toggle ⇒ this file stays in the `isolated` vitest project, per the
// eligibility rules in vitest.config.ts.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PinyinSearchPlugin } from '@objectstack/plugin-pinyin-search';

/** `翟璐` normalizes to `zhailu zl` — the term below lives in the companion only. */
const CJK_NAME = '翟璐';
const PINYIN_TERM = 'zhailu';
/** A latin value in a field the member MAY query. */
const CODE = 'qv7code';

const ROWS = 'cmpscope_rows';
const HIDDEN = 'cmpscope_hidden';

const RowScoped = ObjectSchema.create({
  name: ROWS,
  sharingModel: 'private',
  label: 'Companion Scope Rows',
  pluralLabel: 'Companion Scope Rows',
  fields: { name: Field.text({ label: 'Name', required: true, searchable: true }) },
});

const HiddenField = ObjectSchema.create({
  name: HIDDEN,
  sharingModel: 'public_read_write',
  label: 'Companion Scope Hidden',
  pluralLabel: 'Companion Scope Hidden',
  fields: {
    name: Field.text({ label: 'Name', required: true, searchable: true }),
    code: Field.text({ label: 'Code', searchable: true }),
  },
});

const stackDef = defineStack({
  manifest: {
    id: 'com.dogfood.search-companion-field-scope',
    namespace: 'cmpscope',
    version: '0.0.0',
    type: 'app',
    name: 'Search Companion Field Scope Fixture',
    description: 'A row-scoped object and an object whose name field is hidden from the member.',
  },
  objects: [RowScoped, HiddenField],
});

const objectGrants = {
  [ROWS]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  [HIDDEN]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
};

/** Everyone's fallback: the object grants, no field rule. */
const baselineSet: PermissionSet = PermissionSetSchema.parse({
  name: 'cmpscope_baseline',
  label: 'Companion Scope Baseline — object grants only',
  objects: objectGrants,
});

/** The member's own set: the same grants, with `name` hidden on `cmpscope_hidden`. */
const memberSet: PermissionSet = PermissionSetSchema.parse({
  name: 'cmpscope_member',
  label: 'Companion Scope Member — name hidden on cmpscope_hidden',
  objects: objectGrants,
  fields: { [`${HIDDEN}.name`]: { readable: false, editable: false } },
});

const SYS = { context: { isSystem: true } } as const;

interface SearchBody {
  hits: Array<{ object: string; id: string; title: string }>;
  totalObjects: number;
  totalHits: number;
}

let stack: VerifyStack;
let adminToken: string;
let memberToken: string;
let memberRowId: string;
let adminRowId: string;
let hiddenRowId: string;

const PINYIN_ENV = process.env.OS_SEARCH_PINYIN_ENABLED;

function createdId(body: unknown): string {
  const b = body as { id?: unknown; record?: { id?: unknown }; data?: { id?: unknown } };
  const id = b.id ?? b.record?.id ?? b.data?.id;
  expect(typeof id).toBe('string');
  return String(id);
}

async function create(token: string, object: string, data: Record<string, unknown>): Promise<string> {
  const res = await stack.apiAs(token, 'POST', `/data/${object}`, data);
  const text = await res.text();
  expect(res.status, text).toBeLessThan(300);
  return createdId(JSON.parse(text));
}

async function search(token: string, query: string): Promise<{ status: number; text: string; body: SearchBody }> {
  const res = await stack.apiAs(token, 'GET', `/search?${query}`);
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as SearchBody };
}

function hitIds(body: SearchBody, object: string): string[] {
  return body.hits.filter((h) => h.object === object).map((h) => h.id).sort();
}

async function dataQuery(token: string, object: string, body: Record<string, unknown>): Promise<{ status: number; text: string; ids: string[] }> {
  const res = await stack.apiAs(token, 'POST', `/data/${object}/query`, body);
  const text = await res.text();
  const parsed = JSON.parse(text) as { data?: { records?: unknown[] }; records?: unknown[] };
  const records = (parsed?.data?.records ?? parsed?.records ?? []) as Array<{ id?: unknown }>;
  return { status: res.status, text, ids: records.map((r) => String(r.id)).sort() };
}

describe('dogfood: with the pinyin search companion on, a member searches only what they may see', () => {
  beforeAll(async () => {
    // The registry provisions `__search` only while this is on, and reads it
    // when it is constructed — so it is set before the boot.
    process.env.OS_SEARCH_PINYIN_ENABLED = '1';
    stack = await bootStack(stackDef as never, {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, baselineSet, memberSet],
        fallbackPermissionSet: baselineSet.name,
      }),
      extraPlugins: [new PinyinSearchPlugin({ enabled: true, backfill: false })],
    });
    adminToken = await stack.signIn();
    const memberEmail = 'cmpscope-member@verify.test';
    memberToken = await stack.signUp(memberEmail);

    // Bind the member to its own set (the fallback stays everyone else's).
    const ql = await stack.kernel.getServiceAsync<{
      findOne(object: string, opts: unknown): Promise<{ id?: unknown } | null>;
      insert(object: string, data: Record<string, unknown>, opts: unknown): Promise<unknown>;
    }>('objectql');
    const idOf = async (object: string, where: Record<string, unknown>) =>
      String((await ql.findOne(object, { where, ...SYS }))?.id ?? '');
    const userId = await idOf('sys_user', { email: memberEmail });
    const setId = await idOf('sys_permission_set', { name: memberSet.name });
    expect(userId, 'member user seeded').toBeTruthy();
    expect(setId, 'member permission set seeded').toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: userId, permission_set_id: setId }, SYS);

    memberRowId = await create(memberToken, ROWS, { name: CJK_NAME });
    adminRowId = await create(adminToken, ROWS, { name: CJK_NAME });
    hiddenRowId = await create(adminToken, HIDDEN, { name: CJK_NAME, code: CODE });
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
    if (PINYIN_ENV === undefined) delete process.env.OS_SEARCH_PINYIN_ENABLED;
    else process.env.OS_SEARCH_PINYIN_ENABLED = PINYIN_ENV;
  });

  describe('a row-scoped object', () => {
    it('control: the administrator gets both matching rows through the companion', async () => {
      const { status, text, body } = await search(adminToken, `q=${PINYIN_TERM}&objects=${ROWS}`);
      expect(status, text).toBe(200);
      expect(hitIds(body, ROWS)).toEqual([memberRowId, adminRowId].sort());
    });

    it("the member's search answers only the member's own matching row", async () => {
      const { status, text, body } = await search(memberToken, `q=${PINYIN_TERM}&objects=${ROWS}`);
      expect(status, text).toBe(200);
      expect(hitIds(body, ROWS)).toEqual([memberRowId]);
      expect(text).not.toContain(adminRowId);

      // The data door answers the same.
      const viaData = await dataQuery(memberToken, ROWS, { search: PINYIN_TERM });
      expect(viaData.status, viaData.text).toBe(200);
      expect(viaData.ids).toEqual([memberRowId]);
    });
  });

  describe('a term present only in a field hidden from the member', () => {
    it('control: `name` is hidden from the member at the data door', async () => {
      const res = await stack.apiAs(memberToken, 'GET', `/data/${HIDDEN}/${hiddenRowId}`);
      const text = await res.text();
      expect(res.status, text).toBe(200);
      expect(text).toContain(CODE);
      expect(text).not.toContain(CJK_NAME);
    });

    it('control: the administrator hits the row through the companion (no narrowing keeps it)', async () => {
      const { status, text, body } = await search(adminToken, `q=${PINYIN_TERM}&objects=${HIDDEN}`);
      expect(status, text).toBe(200);
      expect(hitIds(body, HIDDEN)).toEqual([hiddenRowId]);
    });

    it('control: the member hits the same row through a field they may query', async () => {
      const { status, text, body } = await search(memberToken, `q=${CODE}&objects=${HIDDEN}`);
      expect(status, text).toBe(200);
      expect(hitIds(body, HIDDEN)).toEqual([hiddenRowId]);
      // …and the hit carries nothing of the hidden field.
      expect(text).not.toContain(CJK_NAME);
    });

    it("the member's global search yields no hit", async () => {
      const { status, text, body } = await search(memberToken, `q=${PINYIN_TERM}&objects=${HIDDEN}`);
      expect(status, text).toBe(200);
      expect(body.hits).toEqual([]);
      expect(body.totalHits).toBe(0);
    });

    it("the member's searchFields-narrowed data-door query yields no hit", async () => {
      const narrowed = await dataQuery(memberToken, HIDDEN, { search: PINYIN_TERM, searchFields: ['code'] });
      expect(narrowed.status, narrowed.text).toBe(200);
      expect(narrowed.ids).toEqual([]);

      // Same door, same narrowing, a term in the queryable field: the row.
      const control = await dataQuery(memberToken, HIDDEN, { search: CODE, searchFields: ['code'] });
      expect(control.status, control.text).toBe(200);
      expect(control.ids).toEqual([hiddenRowId]);
    });
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// END-TO-END: a member whose global-search scope includes objects they cannot
// read gets hits from the objects they CAN read — not a 403 for the whole
// request.
//
// ## The defect
//
// `GET /api/v1/search` checks authentication only; each object in scope was
// then queried through `engine.find`, whose security middleware refuses an
// object the caller holds no read grant on. `searchAll` let that refusal
// propagate, so a member who could not read EVERY object in scope was answered
// `403 PERMISSION_DENIED` whatever the query. An unscoped search sweeps every
// registered object — the platform's own `sys_*` objects included — so for a
// plain member that was every unscoped search. The console palette sends such
// a scope and rendered "No results found." with no error.
//
// ## What this boot pins
//
// A real kernel with the real `SecurityPlugin`, over HTTP, two app objects
// holding a row that matches the same term: the member's fallback set grants
// read on `skipsearch_open` and nothing on `skipsearch_walled`.
//
//   - the member's UNSCOPED search answers 200 with the readable row, and the
//     walled object is neither hit nor named;
//   - an explicit `objects=` naming the walled object answers 200 with the
//     readable object's hits only — and naming it alone answers exactly as a
//     name that matches no object;
//   - the administrator still gets both rows (the negative control: a fix that
//     skipped everything would turn this red);
//   - the walled object stays refused at its own door (`GET /data/...` 403),
//     so the search is not a way around it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

const TERM = 'zephyrquill';

const SkipSearchOpen = ObjectSchema.create({
  name: 'skipsearch_open',
  sharingModel: 'public_read_write',
  label: 'Skip Search Open',
  pluralLabel: 'Skip Search Open',
  fields: { name: Field.text({ label: 'Name', required: true, searchable: true }) },
});

const SkipSearchWalled = ObjectSchema.create({
  name: 'skipsearch_walled',
  sharingModel: 'public_read_write',
  label: 'Skip Search Walled',
  pluralLabel: 'Skip Search Walled',
  fields: { name: Field.text({ label: 'Name', required: true, searchable: true }) },
});

const stackDef = defineStack({
  manifest: {
    id: 'com.dogfood.search-skip-unreadable',
    namespace: 'skipsearch',
    version: '0.0.0',
    type: 'app',
    name: 'Search Skip Unreadable Fixture',
    description: 'Two searchable objects; the member may read one of them.',
  },
  objects: [SkipSearchOpen, SkipSearchWalled],
});

const memberSet: PermissionSet = PermissionSetSchema.parse({
  name: 'skipsearch_member',
  label: 'Skip Search Member — read on skipsearch_open only',
  objects: {
    skipsearch_open: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
});

interface SearchBody {
  hits: Array<{ object: string; id: string; title: string }>;
  totalObjects: number;
  totalHits: number;
}

let stack: VerifyStack;
let adminToken: string;
let memberToken: string;
let openId: string;
let walledId: string;

function createdId(body: unknown): string {
  const b = body as { id?: unknown; record?: { id?: unknown }; data?: { id?: unknown } };
  const id = b.id ?? b.record?.id ?? b.data?.id;
  expect(typeof id).toBe('string');
  return String(id);
}

async function search(token: string, query: string): Promise<{ status: number; text: string; body: SearchBody }> {
  const res = await stack.apiAs(token, 'GET', `/search?${query}`);
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as SearchBody };
}

describe('dogfood: global search skips the objects a member cannot read', () => {
  beforeAll(async () => {
    stack = await bootStack(stackDef as never, {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, memberSet],
        fallbackPermissionSet: memberSet.name,
      }),
    });
    adminToken = await stack.signIn();
    memberToken = await stack.signUp('skipsearch-member@verify.test');

    const open = await stack.apiAs(adminToken, 'POST', '/data/skipsearch_open', { name: `${TERM} open` });
    expect(open.status).toBeLessThan(300);
    openId = createdId(await open.json());
    const walled = await stack.apiAs(adminToken, 'POST', '/data/skipsearch_walled', { name: `${TERM} walled` });
    expect(walled.status).toBeLessThan(300);
    walledId = createdId(await walled.json());
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('control: the walled object is refused to the member at its own door', async () => {
    const res = await stack.apiAs(memberToken, 'GET', '/data/skipsearch_walled');
    expect(res.status).toBe(403);
    const readable = await stack.apiAs(memberToken, 'GET', '/data/skipsearch_open');
    expect(readable.status).toBe(200);
  });

  it("the member's UNSCOPED search answers the readable object's hit and never names the walled one", async () => {
    const { status, text, body } = await search(memberToken, `q=${TERM}`);

    expect(status, text).toBe(200);
    expect(body.hits.filter((h) => h.object === 'skipsearch_open').map((h) => h.id)).toEqual([openId]);
    expect(body.hits.some((h) => h.object === 'skipsearch_walled')).toBe(false);
    expect(text).not.toContain('skipsearch_walled');
    expect(text).not.toContain(walledId);
  });

  it('an explicit objects= naming the walled object answers the readable hits only', async () => {
    const mixed = await search(memberToken, `q=${TERM}&objects=skipsearch_open,skipsearch_walled`);
    expect(mixed.status).toBe(200);
    expect(mixed.body.hits.map((h) => [h.object, h.id])).toEqual([['skipsearch_open', openId]]);
    expect(mixed.body.totalObjects).toBe(1);
    expect(mixed.text).not.toContain('skipsearch_walled');

    // Naming ONLY the walled object answers exactly as naming no object at all.
    const walledOnly = await search(memberToken, `q=${TERM}&objects=skipsearch_walled`);
    const nonexistent = await search(memberToken, `q=${TERM}&objects=skipsearch_no_such_object`);
    expect(walledOnly.status).toBe(200);
    expect(walledOnly.body).toEqual(nonexistent.body);
    expect(walledOnly.body.hits).toEqual([]);
    expect(walledOnly.body.totalObjects).toBe(0);
  });

  it('negative control: the administrator still gets the hits from both objects', async () => {
    const { status, text, body } = await search(adminToken, `q=${TERM}&objects=skipsearch_open,skipsearch_walled`);
    expect(status, text).toBe(200);
    expect(body.hits.map((h) => [h.object, h.id]).sort()).toEqual(
      [['skipsearch_open', openId], ['skipsearch_walled', walledId]].sort(),
    );
    expect(body.totalObjects).toBe(2);

    const unscoped = await search(adminToken, `q=${TERM}`);
    expect(unscoped.status).toBe(200);
    expect(unscoped.body.hits.filter((h) => h.object.startsWith('skipsearch_')).length).toBe(2);
  });
});

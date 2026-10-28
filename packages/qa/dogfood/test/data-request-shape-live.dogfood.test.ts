// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26572] `api-backend.data-request-shape-and-query-arity` acceptance[1]–[4]
// over the real HTTP stack of a booted showcase. Every pin the item named
// before this file called the RestServer handlers or `HttpDispatcher.dispatch()`
// directly and none booted the Hono adapter, so each `api` clause scored
// partial. These are the item's own steps, driven through the door a client
// reaches:
//
//  - PATCH /data/showcase_task/ID with a `null`, `[]` or `5` body, a body
//    `expectedVersion` of '' and an empty `If-Match`: 400 VALIDATION_FAILED,
//    and the row's `updated_at` (its version) unchanged.
//  - POST /data/showcase_task/query with a `null` body: 400, no rows.
//  - GET /packages?status=a&status=b and the doubled-`keepData` DELETE of the
//    showcase package: 400 VALIDATION_ERROR naming the count, and the package
//    and its tables still answer afterwards (this boot is this file's own, so
//    the destructive probe runs on a throwaway stack).
//  - A member's PATCH with a stale If-Match on an admin-owned
//    `showcase_private_note` (owner-private OWD): 404, byte-identical to the
//    same PATCH with no token — never a 409 carrying `currentRecord`. The
//    admin's stale PATCH on the same row is the positive CONTROL: a 409.
//
// Codes and statuses are asserted; refusal prose only where the clause names
// it ("supplied N times").

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { showcaseAppDefaultSecurity } from './showcase-security.js';

const TASK = 'showcase_task';
const NOTE = 'showcase_private_note';
const PKG = 'com.example.showcase';
const STALE = '2000-01-01T00:00:00.000Z';
const SECRET = 'drs-live-note-body-26572';

const idOf = (b: any): string => String(b?.id ?? b?.record?.id ?? b?.data?.id ?? '');
const codeOf = (b: any): string | undefined => (b?.error && typeof b.error === 'object' ? b.error.code : b?.code);
const recordsOf = (b: any): unknown[] | undefined => b?.records ?? b?.data?.records;

describe('[#26572] /data request-shape gates and dispatcher query arity, over HTTP on a booted showcase', () => {
  let stack: VerifyStack;
  let admin = '';
  let member = '';
  let taskId = '';
  let noteId = '';

  const withHeaders = (token: string, method: string, path: string, headers: Record<string, string>, body: unknown) =>
    stack.api(path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers },
      body: JSON.stringify(body),
    });

  const taskVersion = async (): Promise<string> => {
    const res = await stack.apiAs(admin, 'GET', `/data/${TASK}/${taskId}`);
    expect(res.status, await res.clone().text()).toBe(200);
    const body: any = await res.json();
    return String((body.record ?? body).updated_at);
  };

  beforeAll(async () => {
    stack = await bootShowcase({ security: showcaseAppDefaultSecurity() });
    admin = await stack.signIn();
    member = await stack.signUp('drs-live-member@verify.test');
    // One of the showcase's seeded tasks: the step names "one showcase_task
    // row id and its current version token", not a row of this file's making.
    const tasks = await stack.apiAs(admin, 'GET', `/data/${TASK}?$top=1`);
    expect(tasks.status, await tasks.clone().text()).toBe(200);
    taskId = String((recordsOf(await tasks.json()) as any[] | undefined)?.[0]?.id ?? '');
    expect(taskId, 'the showcase seeds tasks').not.toBe('');
    const note = await stack.apiAs(admin, 'POST', `/data/${NOTE}`, { title: 'drs live note', body: SECRET });
    expect(note.status, await note.clone().text()).toBe(201);
    noteId = idOf(await note.json());
  }, 240_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  describe('acceptance[1] — a PATCH body that is not a record, or a token that can never carry a version', () => {
    for (const [shape, body] of [['null', null], ['an array', []], ['a number', 5]] as const) {
      it(`${shape} body: 400 VALIDATION_FAILED on data, updated_at unchanged`, async () => {
        const before = await taskVersion();
        const res = await stack.apiAs(admin, 'PATCH', `/data/${TASK}/${taskId}`, body);
        const answer: any = await res.json();
        expect({ status: res.status, code: codeOf(answer) }, JSON.stringify(answer)).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
        expect((answer.fields ?? answer.error?.details?.fields ?? []).map((f: any) => f?.field)).toEqual(['data']);
        expect(await taskVersion()).toBe(before);
      });
    }

    it("a body expectedVersion of '': 400 VALIDATION_FAILED, updated_at unchanged", async () => {
      const before = await taskVersion();
      const res = await stack.apiAs(admin, 'PATCH', `/data/${TASK}/${taskId}`, { title: 'drs changed', expectedVersion: '' });
      const answer: any = await res.json();
      expect({ status: res.status, code: codeOf(answer) }, JSON.stringify(answer)).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
      expect(await taskVersion()).toBe(before);
    });

    it('an empty If-Match header: 400 VALIDATION_FAILED, updated_at unchanged', async () => {
      const before = await taskVersion();
      const res = await withHeaders(admin, 'PATCH', `/data/${TASK}/${taskId}`, { 'If-Match': '' }, { title: 'drs changed' });
      const answer: any = await res.json();
      expect({ status: res.status, code: codeOf(answer) }, JSON.stringify(answer)).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
      expect(await taskVersion()).toBe(before);
    });

    it('CONTROL — a record body with the current If-Match updates the row (200) and moves its version', async () => {
      const before = await taskVersion();
      await new Promise((resolve) => setTimeout(resolve, 5));
      const res = await withHeaders(admin, 'PATCH', `/data/${TASK}/${taskId}`, { 'If-Match': before }, { title: 'drs live task, edited' });
      expect(res.status, await res.clone().text()).toBe(200);
      expect(await taskVersion()).not.toBe(before);
    });
  });

  describe('acceptance[2] — a null /query body', () => {
    it('400 VALIDATION_FAILED on query, and no rows', async () => {
      const res = await stack.apiAs(admin, 'POST', `/data/${TASK}/query`, null);
      const answer: any = await res.json();
      expect({ status: res.status, code: codeOf(answer) }, JSON.stringify(answer)).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
      expect(recordsOf(answer)).toBeUndefined();
    });

    it('CONTROL — an empty query answers rows (200)', async () => {
      const res = await stack.apiAs(admin, 'POST', `/data/${TASK}/query`, {});
      expect(res.status, await res.clone().text()).toBe(200);
      expect((recordsOf(await res.json()) ?? []).length).toBeGreaterThan(0);
    });
  });

  describe('acceptance[3] — a repeated single-valued query name on the dispatcher doors', () => {
    const expectArity = async (res: Response, name: string) => {
      const answer: any = await res.json();
      expect({ status: res.status, code: codeOf(answer) }, JSON.stringify(answer)).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
      expect(String(answer.error?.message)).toContain(`"${name}" query parameter was supplied 2 times`);
    };

    it('GET /packages?status=a&status=b: 400 VALIDATION_ERROR, supplied 2 times', async () => {
      await expectArity(await stack.apiAs(admin, 'GET', '/packages?status=a&status=b'), 'status');
    });

    it('DELETE /packages/PKG?keepData=true&keepData=true: refused, and the package and its tables remain', async () => {
      await expectArity(await stack.apiAs(admin, 'DELETE', `/packages/${PKG}?keepData=true&keepData=true`), 'keepData');

      const list = await stack.apiAs(admin, 'GET', '/packages');
      expect(list.status, await list.clone().text()).toBe(200);
      const packages: any[] = ((await list.json()) as any)?.data?.packages ?? [];
      expect(packages.map((p) => p?.manifest?.id)).toContain(PKG);

      const read = await stack.apiAs(admin, 'GET', `/data/${TASK}/${taskId}`);
      expect(read.status, `the showcase's table still serves its rows: ${await read.clone().text()}`).toBe(200);
    });
  });

  describe('acceptance[4] — a stale If-Match on a row the caller cannot read', () => {
    it('member: 404, exactly what the same PATCH with no token answers — no version, no record', async () => {
      const control = await stack.apiAs(member, 'PATCH', `/data/${NOTE}/${noteId}`, { body: 'drs member edit' });
      const controlBody: any = await control.json();
      expect({ status: control.status, code: codeOf(controlBody) }, JSON.stringify(controlBody)).toEqual({ status: 404, code: 'RECORD_NOT_FOUND' });

      const stale = await withHeaders(member, 'PATCH', `/data/${NOTE}/${noteId}`, { 'If-Match': STALE }, { body: 'drs member edit' });
      const text = await stale.text();
      expect(stale.status, text).toBe(404);
      expect(JSON.parse(text)).toEqual(controlBody);
      expect(text).not.toContain('currentVersion');
      expect(text).not.toContain('currentRecord');
      expect(text).not.toContain(SECRET);
    });

    it('CONTROL — the owner\'s stale If-Match on the same row is 409 CONCURRENT_UPDATE: conflict detection is not weakened', async () => {
      const res = await withHeaders(admin, 'PATCH', `/data/${NOTE}/${noteId}`, { 'If-Match': STALE }, { body: 'drs admin edit' });
      const answer: any = await res.json();
      expect({ status: res.status, code: codeOf(answer) }, JSON.stringify(answer)).toEqual({ status: 409, code: 'CONCURRENT_UPDATE' });
    });

    it('the row is untouched by every refused write', async () => {
      const res = await stack.apiAs(admin, 'GET', `/data/${NOTE}/${noteId}`);
      const body: any = await res.json();
      expect((body.record ?? body).body).toBe(SECRET);
    });
  });
});

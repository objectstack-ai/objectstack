// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26572] `api-backend.error-sentences-and-unique-violation-wire-code`
// acceptance[1]–[3] over the real HTTP stack of a booted scratch app
// (`fixtures/error-sentences-fixture.ts`). The item's pins stopped a layer
// short: `rest-hook-script-fault-envelope.test.ts` calls `mapDataError`
// directly, `dispatcher-unique-violation-wire-code.test.ts` drives
// `HttpDispatcher` over a real engine with no Hono adapter, and
// `storage-routes.server-fault-withheld.test.ts` drives the storage handlers
// over a fake request and response.
//
//  - acceptance[1]: a sandboxed `beforeInsert` hook that throws a business
//    sentence and declares no code. `POST /data/OBJECT` and its `/createMany`
//    door answer 400 carrying the sentence verbatim and the ruled
//    `code: 'HOOK_ABORTED'` (#27597: an undeclared hook abort answers the
//    ledgered code, a declared one is kept), and no row is written.
//  - acceptance[2]: a declarative `operation: 'update'` action whose patch
//    repeats a `unique: true` email: `POST /actions/OBJECT/ACTION` answers
//    409 UNIQUE_VIOLATION, `error.details` carries exactly `developerMessage`
//    and `object` (a field's `unique: true` is a tenancy-scoped composite
//    index, so the driver names no single column), and the row keeps its own
//    email.
//  - acceptance[3]: a storage route forced into a server fault — the local
//    adapter's root sits under a regular FILE, so every write it makes fails
//    with the OS's ENOTDIR, which names the server path. The route answers
//    500 INTERNAL with its generic sentence; the caught text, the path and the
//    errno never reach the body.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { StorageServicePlugin } from '@objectstack/service-storage';
import {
  errorSentencesStack,
  errorSentencesSecurity,
  HOOK_SENTENCE,
  TAKEN_EMAIL,
} from './fixtures/error-sentences-fixture.js';

const SYS = { context: { isSystem: true } } as const;
const idOf = (b: any): string => String(b?.id ?? b?.record?.id ?? b?.data?.id ?? '');

describe('[#26572] error answers made honest, over HTTP on a booted scratch app', () => {
  let stack: VerifyStack;
  let admin = '';
  let ql: any;
  const dir = mkdtempSync(join(tmpdir(), 'dogfood-error-sentences-'));
  /** A regular file: the storage root below it can never be created. */
  const blocker = join(dir, 'not-a-directory');

  beforeAll(async () => {
    writeFileSync(blocker, 'a file, not a directory');
    stack = await bootStack(errorSentencesStack as never, {
      security: errorSentencesSecurity(),
      extraPlugins: [new StorageServicePlugin({ adapter: 'local', local: { rootDir: join(blocker, 'storage-root') } })],
    });
    admin = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 240_000);

  afterAll(async () => {
    await stack?.stop?.();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('acceptance[1] — a hook refusal on a /data write door', () => {
    const doors: Array<[string, () => Promise<Response>]> = [
      ['POST /data/OBJECT', () => stack.apiAs(admin, 'POST', '/data/errsent_budget', { name: 'es-live single', amount: 5 })],
      ['POST /data/OBJECT/createMany', () => stack.apiAs(admin, 'POST', '/data/errsent_budget/createMany', [{ name: 'es-live many' }])],
    ];

    for (const [door, send] of doors) {
      it(`${door}: 400 with the hook's own sentence, HOOK_ABORTED, nothing written`, async () => {
        const res = await send();
        const body: any = await res.json();
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(body.error).toBe(HOOK_SENTENCE);
        expect(body.code, `the hook declared no code, so the /data door answers the ruled HOOK_ABORTED: ${JSON.stringify(body)}`).toBe('HOOK_ABORTED');
        expect(await ql.find('errsent_budget', { where: {}, ...SYS })).toHaveLength(0);
      });
    }
  });

  describe('acceptance[2] — a duplicate insert through the action door', () => {
    let freeId = '';

    beforeAll(async () => {
      const taken = await stack.apiAs(admin, 'POST', '/data/errsent_contact', { name: 'es-live holder', email: TAKEN_EMAIL });
      expect(taken.status, await taken.clone().text()).toBe(201);
      const free = await stack.apiAs(admin, 'POST', '/data/errsent_contact', { name: 'es-live free', email: 'free.26572@errsent.test' });
      expect(free.status, await free.clone().text()).toBe(201);
      freeId = idOf(await free.json());
    });

    it('409 UNIQUE_VIOLATION, details exactly { developerMessage, object }, and the row keeps its email', async () => {
      const res = await stack.apiAs(admin, 'POST', '/actions/errsent_contact/errsent_take_email', { recordId: freeId });
      const body: any = await res.json();
      expect({ status: res.status, code: body?.error?.code }, JSON.stringify(body)).toEqual({ status: 409, code: 'UNIQUE_VIOLATION' });
      expect(Object.keys(body.error.details ?? {}).sort()).toEqual(['developerMessage', 'object']);
      expect(body.error.details.object).toBe('errsent_contact');

      const read = await stack.apiAs(admin, 'GET', `/data/errsent_contact/${freeId}`);
      const row: any = await read.json();
      expect((row.record ?? row).email).toBe('free.26572@errsent.test');
    });
  });

  describe('acceptance[3] — a forced 500 on a storage route', () => {
    it('POST /storage/upload/chunked: 500 INTERNAL with the generic sentence, never the caught text', async () => {
      const res = await stack.apiAs(admin, 'POST', '/storage/upload/chunked', {
        filename: 'es-live.bin', mimeType: 'application/octet-stream', totalSize: 10,
      });
      const text = await res.text();
      expect(res.status, text).toBe(500);
      const body = JSON.parse(text);
      expect(body?.error?.code).toBe('INTERNAL');
      expect(typeof body?.error?.message, 'the route still says something').toBe('string');
      for (const leak of ['ENOTDIR', blocker, 'storage-root', 'mkdir', ' at ']) {
        expect(text, `the 500 body carries "${leak}"`).not.toContain(leak);
      }
    });
  });
});

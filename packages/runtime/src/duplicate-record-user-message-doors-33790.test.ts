// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33790] The engine's duplicate-record refusal reaches the writer's locale on
 * every write door, not only on `/data`.
 *
 * ## What was wrong
 *
 * `DuplicateRecordError` composes its end-user sentence in the writer's locale
 * (`endUserMessage`, from the platform operation catalog), and the flat `/data`
 * 409 answers it as `error`. It did not declare it on the producer-marked
 * channel, `userMessage`, so the doors that forward a declared `userMessage`
 * and keep `message` as the thrown diagnostic had nothing to forward: the
 * action door answered `409` with the English diagnostic `message` and no
 * `userMessage`, and an `updateMany` row carried the same English sentence.
 * A console user saving through an action button or a bulk edit read English
 * where the form save read their own language.
 *
 * ## The rule pinned here (seat ruling B′, record 6895764754)
 *
 * The producer declares the sentence as `userMessage`; the doors are not
 * changed, except the row assembler (`toRowApiError`), which now carries a
 * declared `userMessage` the way every whole-request door does. `message`
 * stays the diagnostic everywhere it was. The sentence quotes no record value.
 *
 * ## The rig
 *
 * A real kernel served over its real Hono app: ObjectQL on sqlite-wasm, the
 * REST and dispatcher plugins, auth and security, and an app plugin carrying
 * the object, its declared composite unique index, its `zh-CN` labels, a
 * declarative `operation: 'update'` action and a `type: 'script'` action whose
 * sandboxed body writes through `ctx.api` (the QuickJS hand-back). Every
 * request is an admin's, with `Accept-Language` the only thing that changes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, DuplicateRecordError } from '@objectstack/objectql';
import { HonoServerPlugin, declaredEnvelopeForThrow } from '@objectstack/plugin-hono-server';
import { actionsDoorAnswerOf } from '@objectstack/types';
import { createRestApiPlugin } from '@objectstack/rest';
import { AuthPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, appSecurityPluginOptions } from '@objectstack/plugin-security';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import { AppPlugin } from './app-plugin.js';
import { DefaultDatasourcePlugin } from './default-datasource-plugin.js';
import { createDispatcherPlugin } from './dispatcher-plugin.js';
// Paid at collection, not inside a case's clock (check:test-source-alias):
// the source under test loads it dynamically.
import '@objectstack/metadata';

const BOOT_TIMEOUT = 180_000;
const ORIGIN = 'http://localhost:3000';
const API = '/api/v1';
const ADMIN = { email: 'admin@objectos.ai', password: 'admin123' };
const OBJECT = 'qa_weekly_cost';

/** The values `r1` holds; every write below that repeats them is refused by the composite unique index. */
const TAKEN = { plant: 'P1', carbon_grade: 'G1', cost_week: '2026-W46' };

const ZH = '已存在「工厂」、「牌号」、「成本周次」均相同的记录';
const EN = 'A record with the same “Plant”, “Carbon Grade”, “Cost Week” already exists';
/** The diagnostic `message` keeps: the thrown sentence, in the declared (en) labels' locale of the write. */
const DIAGNOSTIC = /^Duplicate record refused on '/;

const APP: any = {
  manifest: { id: 'com.pin.duplicateusermessage', name: 'Duplicate refusal user message pins', version: '1.0.0' },
  objects: [
    {
      name: OBJECT,
      label: 'Weekly Cost',
      fields: {
        plant: { type: 'text', label: 'Plant' },
        carbon_grade: { type: 'text', label: 'Carbon Grade' },
        cost_week: { type: 'text', label: 'Cost Week' },
      },
      indexes: [{ fields: ['plant', 'carbon_grade', 'cost_week'], unique: 'organization' }],
      actions: [
        { name: 'take_combo', label: 'Take combo', type: 'script', operation: 'update', patch: { ...TAKEN } },
        {
          name: 'take_combo_script',
          label: 'Take combo (script)',
          type: 'script',
          body: {
            language: 'js',
            source:
              `await ctx.api.object('${OBJECT}').update({ id: ctx.recordId, plant: '${TAKEN.plant}', ` +
              `carbon_grade: '${TAKEN.carbon_grade}', cost_week: '${TAKEN.cost_week}' }); return { written: true };`,
            capabilities: ['api.read', 'api.write'],
          },
        },
      ],
    },
  ],
  translations: [
    {
      'zh-CN': {
        objects: {
          [OBJECT]: {
            label: '周成本',
            fields: {
              plant: { label: '工厂' },
              carbon_grade: { label: '牌号' },
              cost_week: { label: '成本周次' },
            },
          },
        },
      },
    },
  ],
};

let kernel: any;
let httpServer: any;
let app: any;
let engine: any;
let adminToken: string;
let r2: string;
let prevNodeEnv: string | undefined;

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** An admin request in `locale`, as the console sends it. */
async function call(locale: string, method: string, path: string, payload?: unknown): Promise<{ status: number; body: any }> {
  const res: Response = await app.request(`${ORIGIN}${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      'Accept-Language': locale,
    },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  });
  return { status: res.status, body: await readJson(res) };
}

async function signIn(who: { email: string; password: string }): Promise<string> {
  const res = await app.request(`${ORIGIN}${API}/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(who),
  });
  if (!res.ok) throw new Error(`pin signIn failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as any).token;
}

/** `r2`, read past every door: no write below may land on it. */
const r2Row = async (): Promise<any> => engine.findOne(OBJECT, { where: { id: r2 }, context: { isSystem: true } });

/** The sentence carries labels only: none of the values the refused write repeats. */
function expectNoRecordValue(text: unknown) {
  expect(typeof text).toBe('string');
  for (const value of Object.values(TAKEN)) expect(text as string).not.toContain(value);
}

beforeAll(async () => {
  prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development'; // the dev-admin seed, as `objectstack dev` / bootStack arm it

  kernel = new ObjectKernel();
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new DefaultDatasourcePlugin({ driver: 'sqlite-wasm', config: { filename: ':memory:' } }));
  await kernel.use(new HonoServerPlugin({ port: 0 }));
  await kernel.use(new AppPlugin(APP));
  await kernel.use(new PlatformObjectsPlugin());
  await kernel.use(new AuthPlugin({ secret: 'duplicate-user-message-doors-secret' }));
  await kernel.use(new SecurityPlugin(appSecurityPluginOptions(APP)));
  await kernel.use(createRestApiPlugin({}));
  await kernel.use(createDispatcherPlugin({}));
  await kernel.bootstrap();

  httpServer = await kernel.getServiceAsync('http-server');
  app = httpServer.getRawApp();
  engine = await kernel.getServiceAsync('objectql');
  adminToken = await signIn(ADMIN);

  const first = await call('en', 'POST', `/data/${OBJECT}`, { ...TAKEN });
  expect(first.status, JSON.stringify(first.body)).toBeLessThan(300);
  const second = await call('en', 'POST', `/data/${OBJECT}`, { plant: 'P2', carbon_grade: 'G2', cost_week: '2026-W47' });
  expect(second.status, JSON.stringify(second.body)).toBeLessThan(300);
  r2 = second.body?.data?.id ?? second.body?.id ?? second.body?.record?.id;
  expect(typeof r2, JSON.stringify(second.body)).toBe('string');
}, BOOT_TIMEOUT);

afterAll(async () => {
  try { await httpServer?.close?.(); } catch { /* best-effort */ }
  try { await kernel?.shutdown?.(); } catch { /* best-effort */ }
  if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNodeEnv;
}, 60_000);

describe.each([
  ['zh-CN', ZH],
  ['en', EN],
] as const)('Accept-Language: %s', (locale, sentence) => {
  it('`PATCH /data/:object/:id` (the flat 409): `userMessage` rides beside `error`, the same sentence', async () => {
    const { status, body } = await call(locale, 'PATCH', `/data/${OBJECT}/${r2}`, { ...TAKEN });

    expect(status, JSON.stringify(body)).toBe(409);
    expect(body.code).toBe('UNIQUE_VIOLATION');
    expect(body.error).toBe(sentence);
    expect(body.userMessage).toBe(sentence);
    expect(body.developerMessage).toMatch(DIAGNOSTIC);
    expectNoRecordValue(body.userMessage);
    expect((await r2Row())?.plant).toBe('P2');
  });

  it('`POST /actions/:object/:action/:id`, a declarative `operation: \'update\'` action: `userMessage`, `message` the diagnostic', async () => {
    const { status, body } = await call(locale, 'POST', `/actions/${OBJECT}/take_combo/${r2}`, {});

    expect(status, JSON.stringify(body)).toBe(409);
    expect(body.error?.code).toBe('UNIQUE_VIOLATION');
    expect(body.error?.userMessage).toBe(sentence);
    expect(body.error?.message).toMatch(DIAGNOSTIC);
    expectNoRecordValue(body.error?.userMessage);
    expect((await r2Row())?.plant).toBe('P2');
  });

  it('`POST /actions/:object/:action/:id`, a sandboxed script body whose `ctx.api` write collides: the QuickJS hand-back keeps `userMessage`', async () => {
    const { status, body } = await call(locale, 'POST', `/actions/${OBJECT}/take_combo_script/${r2}`, {});

    expect(status, JSON.stringify(body)).toBe(409);
    expect(body.error?.code).toBe('UNIQUE_VIOLATION');
    expect(body.error?.userMessage).toBe(sentence);
    expect(body.error?.message).toMatch(DIAGNOSTIC);
    expect((await r2Row())?.plant).toBe('P2');
  });

  it('`POST /data/:object/updateMany`: the row error carries `userMessage`, `message` the diagnostic', async () => {
    const { status, body } = await call(locale, 'POST', `/data/${OBJECT}/updateMany`, {
      records: [{ id: r2, data: { ...TAKEN } }],
    });

    expect(status, JSON.stringify(body)).toBeGreaterThanOrEqual(200);
    const row = body.results?.[0];
    expect(row?.success, JSON.stringify(body)).toBe(false);
    expect(row.errors?.[0]?.code).toBe('UNIQUE_VIOLATION');
    expect(row.errors[0].userMessage).toBe(sentence);
    expect(row.errors[0].message).toMatch(DIAGNOSTIC);
    expectNoRecordValue(row.errors[0].userMessage);
    expect((await r2Row())?.plant).toBe('P2');
  });

  it.each(['create', 'update', 'upsert'] as const)('`POST /data/:object/batch` (`%s`): the row error carries `userMessage`', async (operation) => {
    const record = operation === 'create' ? { data: { ...TAKEN } } : { id: r2, data: { ...TAKEN } };
    const { status, body } = await call(locale, 'POST', `/data/${OBJECT}/batch`, { operation, records: [record] });

    expect(status, JSON.stringify(body)).toBeGreaterThanOrEqual(200);
    const row = body.results?.[0];
    expect(row?.success, JSON.stringify(body)).toBe(false);
    expect(row.errors?.[0]?.code).toBe('UNIQUE_VIOLATION');
    expect(row.errors[0].userMessage).toBe(sentence);
    expect(row.errors[0].message).toMatch(DIAGNOSTIC);
    expect((await r2Row())?.plant).toBe('P2');
  });

  it('`POST /data/:object/createMany` (whole-request): the flat 409 carries `userMessage` beside `error`', async () => {
    const { status, body } = await call(locale, 'POST', `/data/${OBJECT}/createMany`, [{ ...TAKEN }]);

    expect(status, JSON.stringify(body)).toBe(409);
    expect(body.code).toBe('UNIQUE_VIOLATION');
    expect(body.error).toBe(sentence);
    expect(body.userMessage).toBe(sentence);
  });
});

describe('CONTROL', () => {
  it('a row error whose producer marked nothing carries no `userMessage`', async () => {
    // A write naming a field the object does not declare: its producer marks
    // nothing. (An id naming no row is no longer this population: the
    // not-found refusal marks the end user's sentence since #34699.)
    const { body } = await call('zh-CN', 'POST', `/data/${OBJECT}/updateMany`, {
      records: [{ id: r2, data: { no_such_field: 'x' } }],
    });

    const row = body.results?.[0];
    expect(row?.success, JSON.stringify(body)).toBe(false);
    expect(row.errors?.[0]?.code).not.toBe('UNIQUE_VIOLATION');
    expect(row.errors[0]).not.toHaveProperty('userMessage');
  });
});

/**
 * The two boundaries this rig does not drive over HTTP, asked with the
 * engine's own class in the writer's locale: the Hono handler-throw seam
 * (`declaredEnvelopeForThrow`) and the MCP tool error result, which answers
 * from the actions-door resolver (`actionsDoorAnswerOf`). Neither was
 * changed; both forward the declared `userMessage`.
 */
describe('the boundaries asked directly', () => {
  const refusal = () =>
    new DuplicateRecordError(OBJECT, new Error('driver refusal'), undefined, {
      object: '周成本',
      uniqueFields: [
        { name: 'plant', label: '工厂' },
        { name: 'carbon_grade', label: '牌号' },
        { name: 'cost_week', label: '成本周次' },
      ],
      messages: { locale: 'zh-CN' },
    });

  it('the producer declares the sentence on the marked channel; `message` stays the diagnostic', () => {
    const e = refusal();
    expect(e.userMessage).toBe(ZH);
    expect(e.endUserMessage).toBe(ZH);
    expect(e.message).toMatch(DIAGNOSTIC);
  });

  it('Hono handler-throw seam: `error.userMessage`', () => {
    const answer = declaredEnvelopeForThrow(refusal());
    expect(answer?.status).toBe(409);
    expect((answer?.body as any)?.error?.code).toBe('UNIQUE_VIOLATION');
    expect((answer?.body as any)?.error?.userMessage).toBe(ZH);
    expect((answer?.body as any)?.error?.message).toMatch(DIAGNOSTIC);
  });

  it('MCP tool error result (the actions-door resolver): `userMessage`', () => {
    const answer = actionsDoorAnswerOf(refusal(), OBJECT);
    expect(answer.status).toBe(409);
    expect(answer.userMessage).toBe(ZH);
    expect(answer.message).toMatch(DIAGNOSTIC);
  });
});

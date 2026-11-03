// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24131] The anonymous public-form submit enforces the FORM's own `required`.
 *
 * A form entry may declare `{ field: 'email', required: true }` on a field the
 * OBJECT does not require — `examples/app-crm`'s `web_to_lead` form does
 * exactly that. The engine judges only the object's `required`, so the submit
 * door answered `201` and stored the row with the field empty, while the
 * rendered form refused the same submission. Measured on the real route before
 * the fix: absent, `null`, `''` and a whitespace-only string on a form-required
 * text field, and `[]` on a form-required multi-value field, all answered `201`
 * and were stored.
 *
 * Through the real route — `RestServer` → `ObjectStackProtocolImplementation`
 * → `ObjectQL` → `SqlDriver` (sqlite in memory). Only the metadata read is
 * stubbed, to serve the form and the object the route resolves.
 *
 * What is pinned, by class:
 *   - each empty cell of the shared rule (`isEmptyForRequired`) is refused with
 *     `400`, the flat `VALIDATION_FAILED` envelope naming the field, and NO row;
 *   - the envelope is the object-level refusal's, key for key, and a field both
 *     levels require is refused in the exact words the engine used before;
 *   - control: every field present answers `201` and the row lands as sent;
 *   - the object-level refusal of a field only the object requires is the
 *     engine's, unchanged;
 *   - the boundary: an entry the form hides, or shows only conditionally, is not
 *     judged by the door (nothing server-side evaluates a form-view
 *     `visibleWhen`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'pf_required_lead_24131';
const SLUG = 'pf-required-24131';
const SYS = { context: { isSystem: true } };

/** `name` and `company` are object-required; `email` / `tags` / the conditional ones are not. */
const LEAD = {
  name: OBJECT,
  label: 'Lead',
  fields: {
    name: { name: 'name', type: 'text' as const, label: 'Lead Name', required: true },
    company: { name: 'company', type: 'text' as const, label: 'Company', required: true },
    email: { name: 'email', type: 'email' as const, label: 'Email' },
    tags: { name: 'tags', type: 'tags' as const, label: 'Tags' },
    stage: { name: 'stage', type: 'text' as const, label: 'Stage' },
    reason: { name: 'reason', type: 'text' as const, label: 'Reason' },
    referrer: { name: 'referrer', type: 'text' as const, label: 'Referrer' },
    region: { name: 'region', type: 'text' as const, label: 'Region' },
  },
};

const FORM = {
  name: 'pf_required_lead_form',
  object: OBJECT,
  viewKind: 'form',
  config: {
    type: 'simple',
    data: { provider: 'object', object: OBJECT },
    sections: [
      {
        name: 'contact',
        fields: [
          { field: 'name', required: true },
          { field: 'company' },
          { field: 'email', required: true },
          { field: 'tags', required: true },
          { field: 'stage' },
          // Shown only when the predicate holds — nothing server-side evaluates it.
          { field: 'reason', required: true, visibleWhen: { dialect: 'cel', source: "record.stage == 'lost'" } },
          // Never shown to the visitor.
          { field: 'referrer', required: true, hidden: true },
        ],
      },
      {
        name: 'conditional_section',
        visibleWhen: { dialect: 'cel', source: "record.stage == 'won'" },
        fields: [{ field: 'region', required: true }],
      },
    ],
    sharing: { enabled: true, allowAnonymous: true, publicLink: `/forms/${SLUG}` },
  },
};

/** Every field the visitor is asked to fill, filled. */
const COMPLETE = { name: 'Ada', company: 'Analytical Engines', email: 'ada@example.test', tags: ['lead'] };

/** {@link COMPLETE} with one key left out — absent, not `undefined`. */
function without(key: keyof typeof COMPLETE): Record<string, unknown> {
  const body: Record<string, unknown> = { ...COMPLETE };
  delete body[key];
  return body;
}

function mockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    header: () => res,
    end: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: unknown) => { res._json = body; return res; },
  };
  return res;
}

interface Answer { status: number; body: any }

describe('[#24131] POST /forms/:slug/submit enforces the form\'s own `required`', () => {
  let engine: ObjectQL;
  let post: (body: Record<string, unknown>) => Promise<Answer>;
  const rowCount = async (): Promise<number> => (await engine.find(OBJECT, {}, SYS)).length;

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(LEAD as any);
    await engine.syncSchemas();
    // A real `single` install's Default Organization: the system writes below
    // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
    await installDefaultOrganization(engine);

    const protocol: any = new ObjectStackProtocolImplementation(engine as any);
    const realGetMetaItems = protocol.getMetaItems.bind(protocol);
    protocol.getMetaItems = async (request: any) => {
      if (request?.type === 'view') return [FORM];
      if (request?.type === 'object') return [LEAD];
      return realGetMetaItems(request);
    };
    // [#28409] The doors judge withdrawal against the effective list beside
    // the per-package layer: the injected list is that whole layer here.
    protocol.getMetaItemsPerPackage = async (request: any) => (request?.type === 'view' ? [FORM] : []);
    const rest = new RestServer(mockServer() as any, protocol, { api: { requireAuth: false } } as any);
    rest.registerRoutes();
    const submit = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/forms/:slug/submit');
    expect(submit, 'the submit route is registered').toBeDefined();
    post = async (body) => {
      const res = makeRes();
      await submit!.handler({ params: { slug: SLUG }, body: JSON.parse(JSON.stringify(body)) } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
  }, 60_000);

  afterAll(async () => {
    await engine?.destroy().catch(() => {});
  });

  /** A refusal that names exactly `field`, and stores nothing. */
  const expectRefused = async (body: Record<string, unknown>, field: string, label: string) => {
    const before = await rowCount();
    const answer = await post(body);
    expect(answer.status, JSON.stringify(answer.body)).toBe(400);
    expect(answer.body.code).toBe('VALIDATION_FAILED');
    expect(answer.body.fields).toEqual([
      { field, code: 'required', message: `${label} is required`, label },
    ]);
    expect(answer.body.error).toBe(`${label} is required`);
    expect(await rowCount(), 'a refused submit stores no row').toBe(before);
    return answer;
  };

  it.each([
    ['absent', without('email')],
    ['null', { ...COMPLETE, email: null }],
    ["''", { ...COMPLETE, email: '' }],
    ['whitespace-only', { ...COMPLETE, email: '   ' }],
  ])('a form-required text field the object does not require, %s → 400 naming it, no row', async (_cell, body) => {
    await expectRefused(body, 'email', 'Email');
  }, 60_000);

  it.each([
    ['[]', { ...COMPLETE, tags: [] }],
    ['absent', without('tags')],
  ])('a form-required multi-value field, %s → 400 naming it, no row', async (_cell, body) => {
    await expectRefused(body, 'tags', 'Tags');
  }, 60_000);

  it('two form-required fields missing → one refusal naming both, in the form\'s order', async () => {
    const before = await rowCount();
    const answer = await post({ name: 'Ada', company: 'Analytical Engines' });
    expect(answer.status).toBe(400);
    expect(answer.body.code).toBe('VALIDATION_FAILED');
    expect(answer.body.fields.map((f: any) => [f.field, f.code])).toEqual([['email', 'required'], ['tags', 'required']]);
    expect(answer.body.error).toBe('Email is required; Tags is required');
    expect(await rowCount()).toBe(before);
  }, 60_000);

  it('CONTROL — every field the visitor is asked to fill, filled → 201, and the row lands as sent', async () => {
    const before = await rowCount();
    const answer = await post(COMPLETE);
    expect(answer.status, JSON.stringify(answer.body)).toBe(201);
    expect(typeof answer.body.id).toBe('string');
    const stored = await engine.findOne(OBJECT, { where: { id: answer.body.id } }, SYS);
    expect(stored).toMatchObject({ name: 'Ada', company: 'Analytical Engines', email: 'ada@example.test', tags: ['lead'] });
    expect(await rowCount()).toBe(before + 1);
  }, 60_000);

  it('a field only the OBJECT requires is still refused by the engine, unchanged — and the form-level refusal is the same envelope', async () => {
    const before = await rowCount();
    const engineAnswer = await post(without('company'));
    expect(engineAnswer.status).toBe(400);
    expect(engineAnswer.body).toEqual({
      error: 'Company is required',
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'company', code: 'required', message: 'Company is required', label: 'Company' }],
    });
    expect(await rowCount()).toBe(before);

    const formAnswer = await expectRefused(without('email'), 'email', 'Email');
    expect(Object.keys(formAnswer.body)).toEqual(Object.keys(engineAnswer.body));
    expect(Object.keys(formAnswer.body.fields[0])).toEqual(Object.keys(engineAnswer.body.fields[0]));
  }, 60_000);

  it('a field BOTH levels require is refused in the exact words the engine answered before the door judged it', async () => {
    const answer = await expectRefused(without('name'), 'name', 'Lead Name');
    // The body the engine's object-level check answered on this route before the
    // fix, measured on origin/main 747c8e9c4.
    expect(answer.body).toEqual({
      error: 'Lead Name is required',
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'name', code: 'required', message: 'Lead Name is required', label: 'Lead Name' }],
    });
  }, 60_000);

  it('BOUNDARY — a hidden entry, a conditionally visible entry and an entry in a conditional section are not judged by the door', async () => {
    const answer = await post(COMPLETE);
    expect(answer.status, JSON.stringify(answer.body)).toBe(201);
    const stored = await engine.findOne(OBJECT, { where: { id: answer.body.id } }, SYS);
    expect(stored?.reason ?? null).toBeNull();
    expect(stored?.referrer ?? null).toBeNull();
    expect(stored?.region ?? null).toBeNull();
  }, 60_000);
});

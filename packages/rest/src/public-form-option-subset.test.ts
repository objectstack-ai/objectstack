// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27606] The anonymous public-form submit enforces a form row's declared
 * `options` subset.
 *
 * A form row may list `options` to offer a deliberate subset of a select
 * field's members — HotCRM's web-to-case form offers a guest
 * `[low, medium, high]` of a priority that also has `critical`. `GET
 * /forms/:slug` serves that subset, but the submit door judged keys and the
 * form's `required` only, so `POST /forms/:slug/submit` stored `critical` with
 * a `201`: the engine judges a value against the OBJECT's options, never a
 * form's. Measured on the real route before the fix (single and multi-valued
 * select alike).
 *
 * Through the real route — `RestServer` → `ObjectStackProtocolImplementation`
 * → `ObjectQL` → `SqlDriver` (sqlite in memory). Only the metadata read is
 * stubbed, to serve the forms and the object the route resolves.
 *
 * Pinned, by class:
 *   - a value outside the row's subset is refused: `400`, the flat
 *     `VALIDATION_FAILED` envelope naming the field with the ADR-0114 field
 *     code `invalid_option`, the allowed values the subset's only, the write
 *     never attempted and no row stored;
 *   - a multi-valued field: every element is judged, the first outside one named;
 *   - one envelope with the form's `required` judgement: both are told at once;
 *   - control: a value inside the subset saves, `201`, the row stored as sent;
 *   - control: an empty or absent optional value submits;
 *   - the boundary: a row that lists no `options` keeps the object's full set,
 *     and a field offered by another row without a subset is not narrowed.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'pf_subset_case_27606';
const SLUG = 'pf-subset-27606';
const WIDE_SLUG = 'pf-subset-wide-27606';
const LOOSE_SLUG = 'pf-subset-loose-27606';
const SYS = { context: { isSystem: true } };

const CASE = {
  name: OBJECT,
  label: 'Case',
  fields: {
    subject: { name: 'subject', type: 'text' as const, label: 'Subject', required: true },
    priority: {
      name: 'priority',
      type: 'select' as const,
      label: 'Priority',
      options: [
        { label: 'Low', value: 'low' },
        { label: 'Medium', value: 'medium' },
        { label: 'High', value: 'high' },
        { label: 'Critical', value: 'critical' },
      ],
    },
    topics: {
      name: 'topics',
      type: 'select' as const,
      label: 'Topics',
      multiple: true,
      options: [
        { label: 'Billing', value: 'billing' },
        { label: 'Outage', value: 'outage' },
        { label: 'Security', value: 'security' },
      ],
    },
    channel: {
      name: 'channel',
      type: 'select' as const,
      label: 'Channel',
      options: [
        { label: 'Web', value: 'web' },
        { label: 'Email', value: 'email' },
        { label: 'Phone', value: 'phone' },
      ],
    },
  },
};

const form = (name: string, slug: string, sections: unknown[]) => ({
  name,
  object: OBJECT,
  viewKind: 'form',
  config: {
    type: 'simple',
    data: { provider: 'object', object: OBJECT },
    sections,
    sharing: { enabled: true, allowAnonymous: true, publicLink: `/forms/${slug}` },
  },
});

const FORM = form('pf_subset_case_form', SLUG, [
  {
    name: 'case',
    fields: [
      { field: 'subject', required: true },
      {
        field: 'priority',
        options: [
          { label: 'Low', value: 'low' },
          { label: 'Medium', value: 'medium' },
          { label: 'High', value: 'high' },
        ],
      },
      { field: 'topics', options: [{ label: 'Billing', value: 'billing' }, { label: 'Outage', value: 'outage' }] },
      // No `options`: the object's full set.
      { field: 'channel' },
    ],
  },
]);

// The same field on two rows, one narrowing it and one not: the form offers
// the full set, so the door does not narrow it.
const WIDE_FORM = form('pf_subset_case_wide_form', WIDE_SLUG, [
  { name: 'first', fields: [{ field: 'subject' }, { field: 'priority', options: [{ label: 'Low', value: 'low' }] }] },
  { name: 'second', fields: ['priority'] },
]);

// Option shapes the strict row schema refuses, reaching the door only from an
// unparsed source: bare-string options read as their own values, and options
// that carry no value at all narrow nothing.
const LOOSE_FORM = form('pf_subset_case_loose_form', LOOSE_SLUG, [
  {
    name: 'loose',
    fields: [
      { field: 'subject' },
      { field: 'priority', options: ['low', 'medium'] },
      { field: 'channel', options: [{ label: 'Web' }] },
    ],
  },
]);

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

describe('[#27606] POST /forms/:slug/submit: a form row\'s `options` subset is enforced', () => {
  let engine: ObjectQL;
  let createData: ReturnType<typeof vi.fn>;
  let post: (body: Record<string, unknown>, slug?: string) => Promise<Answer>;
  const rows = async (): Promise<Array<Record<string, any>>> => (await engine.find(OBJECT, {}, SYS)) as any;

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(CASE as any);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);

    const protocol: any = new ObjectStackProtocolImplementation(engine as any);
    const realGetMetaItems = protocol.getMetaItems.bind(protocol);
    protocol.getMetaItems = async (request: any) => {
      if (request?.type === 'view') return [FORM, WIDE_FORM, LOOSE_FORM];
      if (request?.type === 'object') return [CASE];
      return realGetMetaItems(request);
    };
    const realCreateData = protocol.createData.bind(protocol);
    createData = vi.fn(realCreateData);
    protocol.createData = createData;
    const rest = new RestServer(mockServer() as any, protocol, { api: { requireAuth: false } } as any);
    rest.registerRoutes();
    const submit = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/forms/:slug/submit');
    expect(submit, 'the submit route is registered').toBeDefined();
    post = async (body, slug = SLUG) => {
      const res = makeRes();
      await submit!.handler({ params: { slug }, body: JSON.parse(JSON.stringify(body)) } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
  }, 60_000);

  afterAll(async () => {
    await engine?.destroy().catch(() => {});
  });

  /** A refusal naming exactly `expected` (field, code, label) in order, the write never attempted, no row stored. */
  const expectRefused = async (body: Record<string, unknown>, expected: Array<[string, string, string]>, slug?: string) => {
    const before = (await rows()).length;
    const calls = createData.mock.calls.length;
    const answer = await post(body, slug);
    expect(answer.status, JSON.stringify(answer.body)).toBe(400);
    expect(answer.body.code).toBe('VALIDATION_FAILED');
    expect(answer.body.fields.map((f: any) => [f.field, f.code, f.label])).toEqual(expected);
    for (const f of answer.body.fields) expect(f.message).toContain(f.label);
    expect(createData.mock.calls.length, 'the write is never attempted').toBe(calls);
    expect((await rows()).length, 'a refused submit stores no row').toBe(before);
    return answer;
  };

  const expectStored = async (body: Record<string, unknown>, slug?: string) => {
    const before = (await rows()).length;
    const answer = await post(body, slug);
    expect(answer.status, JSON.stringify(answer.body)).toBe(201);
    expect(typeof answer.body.id).toBe('string');
    const all = await rows();
    expect(all.length).toBe(before + 1);
    return all.find((r) => r.id === answer.body.id);
  };

  it('a value outside the row\'s subset is refused, naming the field and only the subset\'s values', async () => {
    const answer = await expectRefused({ subject: 'Site down', priority: 'critical' }, [['priority', 'invalid_option', 'Priority']]);
    const [refusal] = answer.body.fields;
    expect(refusal.constraint).toEqual({ allowed: 'low, medium, high' });
    // The refusal discloses nothing the form does not publish.
    expect(JSON.stringify(answer.body)).not.toContain('Critical');
    expect(refusal.message).not.toContain('critical');
    // The engine's single-value `invalid_option` ships no `value`; neither does the door's.
    expect(refusal).not.toHaveProperty('value');
  }, 60_000);

  it('a value that is no member of the object at all is refused by the same judgement', async () => {
    await expectRefused({ subject: 'Site down', priority: 'urgent' }, [['priority', 'invalid_option', 'Priority']]);
  }, 60_000);

  it('a multi-valued field: an element outside the subset is refused, naming it', async () => {
    const answer = await expectRefused(
      { subject: 'Site down', topics: ['billing', 'security'] },
      [['topics', 'invalid_option', 'Topics']],
    );
    expect(answer.body.fields[0].message).toContain('security');
    // The offending element, as the engine's multi-valued `invalid_option` ships it.
    expect(answer.body.fields[0].value).toBe('security');
    expect(answer.body.fields[0].constraint).toEqual({ allowed: 'billing, outage' });
  }, 60_000);

  it('one envelope with the form\'s `required`: a missing required field and an outside value are told at once', async () => {
    await expectRefused({ priority: 'critical' }, [['subject', 'required', 'Subject'], ['priority', 'invalid_option', 'Priority']]);
  }, 60_000);

  it('CONTROL — a value inside the subset saves', async () => {
    const stored = await expectStored({ subject: 'Slow page', priority: 'high', topics: ['billing', 'outage'] });
    expect(stored?.priority).toBe('high');
    expect(stored?.topics).toEqual(['billing', 'outage']);
  }, 60_000);

  it.each([
    ['absent', {}],
    ['null', { priority: null, topics: null }],
    ["''", { priority: '' }],
    ['[] on the multi-valued field', { topics: [] }],
  ])('CONTROL — an empty or absent optional value submits (%s)', async (_cell, extra) => {
    const stored = await expectStored({ subject: 'Question', ...extra });
    expect([null, undefined, '']).toContain(stored?.priority);
  }, 60_000);

  it('BOUNDARY — a row that lists no `options` keeps the object\'s full set', async () => {
    const stored = await expectStored({ subject: 'Called in', channel: 'phone' });
    expect(stored?.channel).toBe('phone');
  }, 60_000);

  it('a bare-string option is read as its own value', async () => {
    const answer = await expectRefused({ subject: 'Site down', priority: 'critical' }, [['priority', 'invalid_option', 'Priority']], LOOSE_SLUG);
    expect(answer.body.fields[0].constraint).toEqual({ allowed: 'low, medium' });
    const stored = await expectStored({ subject: 'Slow page', priority: 'medium' }, LOOSE_SLUG);
    expect(stored?.priority).toBe('medium');
  }, 60_000);

  it('BOUNDARY — options that carry no value narrow nothing (never refuse every value)', async () => {
    const stored = await expectStored({ subject: 'Called in', channel: 'phone' }, LOOSE_SLUG);
    expect(stored?.channel).toBe('phone');
  }, 60_000);

  it('BOUNDARY — a field another row offers without a subset is not narrowed', async () => {
    const stored = await expectStored({ subject: 'Site down', priority: 'critical' }, WIDE_SLUG);
    expect(stored?.priority).toBe('critical');
  }, 60_000);
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22437] The anonymous public-form submit answers `201` with the created
// record's id, and nothing the insert stored.
//
// The door used to relay `createData`'s whole answer — `{ object, id, record,
// droppedFields? }` — so the anonymous caller received the row as stored after
// the insert pipeline: every field it never sent, and every field a
// `beforeInsert` / `afterInsert` hook derived. A hook that runs elevated can
// derive a field from EXISTING records, and through the echo that derivation
// reached anyone on the internet. The caller already knows what it submitted,
// so the answer is the one fact it cannot know: the id of the row it created.
// Projecting the row to the form's declared fields was rejected, because a
// hook may rewrite a declared field too.
//
// Two halves, one subject:
//   - on the registered handler, with a `createData` answer carrying a stored
//     row, a derived field and a drop report, the body is exactly `{ id }`;
//   - through the real Hono transport, the wire is that same bare object with
//     no envelope, so the top-level `id` — the key path the console's success
//     screen reads the created id from — still resolves.
//
// The elevated-hook case on a real boot (a hook that reads an existing record
// and stamps what it found) is pinned in the dogfood suite,
// `public-form-submit-answer.dogfood.test.ts`. Fixtures are synthetic.

import { describe, it, expect, vi } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import * as specApi from '@objectstack/spec/api';
import { PublicFormSubmitResponseSchema } from '@objectstack/spec/api';
import { RestServer } from './rest-server';
import { REST_ROUTE_LEDGER } from './rest-route-ledger';

// [#10126] Pay the first transform of this dist-resolved workspace dep at MODULE
// LOAD, as `public-form-routes.test.ts` does for the same routes.
import '@objectstack/spec/ui';

const CREATED_ID = 'rec_answer_1';
/** Synthetic values the stored row carries. None may reach the anonymous caller. */
const DERIVED = 'SYNTH-DERIVED-FROM-EXISTING-7311';
const STAFF = 'usr_synthetic_staff_7311';
const DEFAULTED = 'SYNTH-DEFAULTED-7311';

/** What the protocol's `createData` answers: the stored row, a derived stamp, a drop report. */
const CREATE_ANSWER = {
  object: 'answer_request',
  id: CREATED_ID,
  record: {
    id: CREATED_ID,
    subject: 'Help',
    email: 'someone@example.test',
    stage: DEFAULTED,
    match_ref: DERIVED,
    owner_id: STAFF,
    created_at: '2026-01-01T00:00:00Z',
  },
  droppedFields: [{ object: 'answer_request', fields: ['stage'], reason: 'readonly' }],
};

function formView() {
  return {
    name: 'answer_request_form',
    object: 'answer_request',
    viewKind: 'form',
    config: {
      data: { object: 'answer_request' },
      sections: [{ fields: ['subject', { field: 'email' }] }],
      sharing: { enabled: true, allowAnonymous: true, publicLink: '/forms/answer' },
    },
  };
}

const requestObject = {
  name: 'answer_request',
  label: 'Answer Request',
  fields: {
    id: { type: 'text' },
    subject: { type: 'text', label: 'Subject' },
    email: { type: 'text', label: 'Email' },
    stage: { type: 'text', label: 'Stage' },
    match_ref: { type: 'text', label: 'Match ref' },
    owner_id: { type: 'lookup', reference: 'sys_user', label: 'Owner' },
  },
};

function protocolDouble() {
  return {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn(async ({ type }: { type: string }) => {
      if (type === 'view') return [formView()];
      if (type === 'object') return [requestObject];
      return [];
    }),
    createData: vi.fn().mockResolvedValue(CREATE_ANSWER),
  };
}

function mockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  res.header = vi.fn(() => res);
  res.end = vi.fn(() => res);
  return res;
}

const SUBMITTED = { subject: 'Help', email: 'someone@example.test' };

describe('[#22437] POST /forms/:slug/submit answers the created id, and nothing the insert stored', () => {
  it('the registered handler answers 201 with exactly { id }', async () => {
    const protocol = protocolDouble();
    const rest = new RestServer(mockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    const submit = rest.getRoutes().find((r) => r.method === 'POST' && r.path.endsWith('/forms/:slug/submit'))!;
    const res = mockRes();

    await submit.handler({ params: { slug: 'answer' }, body: { ...SUBMITTED } } as any, res);

    // Lit: the write really ran, and the double really answered a stored row.
    expect(protocol.createData).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ id: CREATED_ID });
    expect(Object.keys(res.body)).toEqual(['id']);
    // Asserted against the whole serialized answer, not one key: the finding is
    // about VALUES escaping, under whatever key.
    const wire = JSON.stringify(res.body);
    for (const leak of [DERIVED, STAFF, DEFAULTED, 'answer_request', 'droppedFields', 'record']) {
      expect(wire, `${leak} must not reach the anonymous caller`).not.toContain(leak);
    }
  });

  it('through the real transport: 201, a bare JSON object, and the created id at the top-level `id`', async () => {
    const server = new HonoHttpServer(0);
    const protocol = protocolDouble();
    const rest = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    server.installNotFoundSeam();

    const res: Response = await server.getRawApp().fetch(new Request('http://local/api/v1/forms/answer/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SUBMITTED),
    }));

    expect(res.status).toBe(201);
    expect(protocol.createData).toHaveBeenCalledTimes(1);
    expect(protocol.createData.mock.calls[0][0].data).toEqual(SUBMITTED);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ id: CREATED_ID });
    // The console's success screen reads the created id off the top-level `id`,
    // after stripping a `{ success, data }` transport envelope when one is
    // present. This door answers no envelope, so the body itself is what it
    // reads, and the key is a non-empty string.
    expect('success' in body).toBe(false);
    expect('data' in body).toBe(false);
    expect(typeof body.id).toBe('string');
    expect(body.id).not.toBe('');
  });
});

// ── [#28005, ruling B] The thank-you panel's named fields ───────────────────
//
// The one widening of the answer above: when the form's `thank-you` panel names
// fields of the record as `{{record.field_name}}` (`thankYouRecordFieldNames`),
// the answer carries `fields`, holding exactly those fields' stored values. A
// name survives only when, AT ANSWER TIME, it is an own field of the object
// whose type is in `RUNTIME_OWNED_FIELD_TYPES` (today `autonumber`), and the
// row `createData` answered carries it as a string or a number. Every answer is
// parsed with `PublicFormSubmitResponseSchema` (strict), the schema the route
// ledger names for this route.

const CASE_NUMBER = 'CASE-SYNTH-0042';

/** A form whose thank-you panel names `names`, on an object declaring `fields`. */
function tokenProtocol(opts: {
  message: string;
  fields?: Record<string, unknown>;
  record?: Record<string, unknown>;
}) {
  const view = formView();
  (view.config as any).submitBehavior = { kind: 'thank-you', title: 'Thanks', message: opts.message };
  const object = {
    ...requestObject,
    fields: { ...requestObject.fields, case_number: { type: 'autonumber', label: 'Case number' }, ...opts.fields },
  };
  const record = opts.record ?? { ...CREATE_ANSWER.record, case_number: CASE_NUMBER };
  return {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn(async ({ type }: { type: string }) => {
      if (type === 'view') return [view];
      if (type === 'object') return [object];
      return [];
    }),
    createData: vi.fn().mockResolvedValue({ ...CREATE_ANSWER, record }),
  };
}

async function submitThrough(protocol: ReturnType<typeof tokenProtocol>) {
  const rest = new RestServer(mockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const submit = rest.getRoutes().find((r) => r.method === 'POST' && r.path.endsWith('/forms/:slug/submit'))!;
  const res = mockRes();
  await submit.handler({ params: { slug: 'answer' }, body: { ...SUBMITTED } } as any, res);
  // Lit: the write ran, and the answer is the declared shape (strict: no third key).
  expect(protocol.createData).toHaveBeenCalledTimes(1);
  expect(res.statusCode).toBe(201);
  expect(PublicFormSubmitResponseSchema.safeParse(res.body).success, JSON.stringify(res.body)).toBe(true);
  return res.body as Record<string, unknown>;
}

/** No stored value other than the id and `allowed` reaches the wire. */
function expectNoOtherStoredValue(body: unknown, allowed: readonly string[] = []) {
  const wire = JSON.stringify(body);
  for (const leak of [DERIVED, STAFF, DEFAULTED, 'droppedFields', 'record', 'someone@example.test', '2026-01-01T00:00:00Z']) {
    if (allowed.includes(leak)) continue;
    expect(wire, `${leak} must not reach the anonymous caller`).not.toContain(leak);
  }
}

describe('[#28005] POST /forms/:slug/submit answers the engine-generated fields its thank-you panel names', () => {
  it('a panel naming an autonumber field answers { id, fields: { that_field } }, and nothing else stored', async () => {
    const body = await submitThrough(tokenProtocol({ message: 'Your case number is {{record.case_number}}.' }));
    expect(body).toEqual({ id: CREATED_ID, fields: { case_number: CASE_NUMBER } });
    expect(Object.keys(body)).toEqual(['id', 'fields']);
    expectNoOtherStoredValue(body);
  });

  it('a name in the title and the message is answered once', async () => {
    const protocol = tokenProtocol({ message: 'Again: {{record.case_number}}' });
    const view = (await protocol.getMetaItems({ type: 'view' }))[0] as any;
    view.config.submitBehavior.title = 'Case {{record.case_number}}';
    const body = await submitThrough(protocol);
    expect(body).toEqual({ id: CREATED_ID, fields: { case_number: CASE_NUMBER } });
  });

  it('a panel with no token answers { id } only', async () => {
    const body = await submitThrough(tokenProtocol({ message: 'We received your message.' }));
    expect(body).toEqual({ id: CREATED_ID });
    expect(Object.keys(body)).toEqual(['id']);
    expectNoOtherStoredValue(body);
  });

  it('drop rule — type: a name whose field was retyped to text after publish is dropped', async () => {
    const body = await submitThrough(tokenProtocol({
      message: 'Your case number is {{record.case_number}}.',
      fields: { case_number: { type: 'text', label: 'Case number' } },
    }));
    expect(body).toEqual({ id: CREATED_ID });
  });

  it('drop rule — type: a name that is no own field of the object (a system column) is dropped, the rest kept', async () => {
    const body = await submitThrough(tokenProtocol({
      message: 'Filed {{record.created_at}} by {{record.owner_id}} as {{record.case_number}} ({{record.constructor}})',
    }));
    expect(body).toEqual({ id: CREATED_ID, fields: { case_number: CASE_NUMBER } });
    expectNoOtherStoredValue(body);
  });

  it('drop rule — stored: a name the answered row does not carry (masked or stripped) is dropped', async () => {
    const { case_number: _omitted, ...withoutCaseNumber } = { ...CREATE_ANSWER.record, case_number: CASE_NUMBER };
    const body = await submitThrough(tokenProtocol({
      message: 'Your case number is {{record.case_number}}.',
      record: withoutCaseNumber,
    }));
    expect(body).toEqual({ id: CREATED_ID });
  });

  it('drop rule — value: a stored value that is neither a string nor a number is dropped, never answered as null', async () => {
    const body = await submitThrough(tokenProtocol({
      message: 'Your case number is {{record.case_number}}.',
      record: { ...CREATE_ANSWER.record, case_number: null },
    }));
    expect(body).toEqual({ id: CREATED_ID });
  });

  it('the route ledger names PublicFormSubmitResponseSchema for this route, the schema parsed above', () => {
    const row = REST_ROUTE_LEDGER.find((e) => e.route === 'POST /api/v1/forms/:slug/submit');
    expect(row, 'the submit row must exist in REST_ROUTE_LEDGER').toBeDefined();
    expect(row!.responseSchema).toBe('PublicFormSubmitResponseSchema');
    expect((specApi as unknown as Record<string, unknown>)[row!.responseSchema!]).toBe(PublicFormSubmitResponseSchema);
  });
});

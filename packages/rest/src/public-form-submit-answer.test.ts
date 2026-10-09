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
import { RestServer } from './rest-server';

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

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26571] `access-security.anonymous-floor-v18-doors`, acceptance[1],
// acceptance[3] and acceptance[4], over HTTP on the stock showcase.
//
// `anonymous-door-sweep.dogfood.test.ts` sends one unauthenticated request per
// registered route and scores the everything-else class by status and an error
// envelope; it never reads `error.code`, its share-link token class accepts
// any 4xx (401 included), and its form submit sends no forged field. The item
// scores those legs at the `api` oracle, so this file drives exactly the doors
// its steps list:
//
//   - acceptance[1]: each listed v18 door answers an anonymous caller 401 with
//     its family's unauthenticated code, and the admin's identical call is
//     served (the door itself serves) — except `GET /keys`, which the domain
//     answers 405 because `/keys` serves POST alone, so its 401 is the floor's
//     by the same argument;
//   - acceptance[3]: the share-link token face is outside the floor — a bogus
//     token gets the face's own refusal, never 401;
//   - acceptance[4]: an anonymous public-form submit that forges `owner_id`
//     and a non-whitelisted `status` answers 201 with a body that is exactly
//     `{ id }`.
//
// acceptance[2] (the retired `/docs` path, anonymous and as the admin) is
// pinned in `showcase-anonymous-deny-surfaces.dogfood.test.ts`. Isolated boot:
// the form submit lands a row.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as const;
/** The two spellings the item accepts for the floor's machine code, per family. */
const UNAUTHENTICATED_CODES = ['UNAUTHENTICATED', 'AUTH_REQUIRED'];

/** steps[0]'s doors, by full path (the branding door is outside `/api/v1`). */
const DOORS = [
  '/api/v1/notifications',
  '/api/v1/keys',
  '/api/v1/share-links',
  '/api/v1/openapi.json',
  '/api/v1/i18n/locales',
  '/api/settings/branding',
] as const;

const codeOf = (body: any) =>
  (body?.error && typeof body.error === 'object' ? body.error.code : undefined) ?? body?.code ?? null;

describe('the v18 anonymous floor, door by door, on the stock showcase', () => {
  let stack: VerifyStack;
  let admin: string;
  let ql: any;

  const call = async (path: string, token?: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers as Record<string, string>) };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await stack.raw(path, { ...init, headers });
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body, text };
  };

  beforeAll(async () => {
    stack = await bootShowcase();
    admin = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it.each(DOORS)('acceptance[1]: anonymous GET %s answers 401 with the unauthenticated code', async (path) => {
    const r = await call(path, undefined, { method: 'GET' });
    expect(r.status, r.text).toBe(401);
    expect(UNAUTHENTICATED_CODES, `the code on ${path}: ${r.text}`).toContain(codeOf(r.body));
  });

  // `/keys` serves POST alone (#23909 registers every verb so the floor answers
  // them all), so its GET is the domain's 405 to the admin and is no control.
  it.each(DOORS.filter((d) => d !== '/api/v1/keys'))('acceptance[1]: the admin\'s GET %s is served — the door itself serves', async (path) => {
    const r = await call(path, admin, { method: 'GET' });
    expect(r.status, r.text).toBe(200);
  });

  it('acceptance[3]: a bogus share-link token answers the token face\'s own refusal, never the floor\'s 401', async () => {
    const r = await call('/api/v1/share-links/BOGUS/resolve', undefined, { method: 'GET' });
    expect(r.status, r.text).not.toBe(401);
    expect(r.status, 'a refusal, not a serve').toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
    expect(UNAUTHENTICATED_CODES, 'not the floor\'s code').not.toContain(codeOf(r.body));
  });

  it('acceptance[4]: an anonymous submit forging owner_id and status answers 201 with exactly { id }', async () => {
    const marker = `anon-floor-v18-${Date.now()}`;
    const r = await call('/api/v1/forms/contact-us/submit', undefined, {
      method: 'POST',
      body: JSON.stringify({
        name: marker,
        email: 'anon.floor@example.com',
        company: 'Floor Co',
        message: 'v18 floor',
        owner_id: 'usr_forged_owner',
        status: 'qualified',
      }),
    });
    expect(r.status, r.text).toBe(201);
    expect(Object.keys(r.body ?? {}), 'nothing stored, defaulted or stamped is echoed').toEqual(['id']);
    const [row] = await ql.find('showcase_inquiry', { where: { name: marker }, context: SYS });
    expect(row?.id, 'the submission landed').toBe(r.body.id);
    expect(row.owner_id, 'the forged owner was not stored').not.toBe('usr_forged_owner');
    expect(row.status, 'the non-whitelisted status was not stored').not.toBe('qualified');
  });
});

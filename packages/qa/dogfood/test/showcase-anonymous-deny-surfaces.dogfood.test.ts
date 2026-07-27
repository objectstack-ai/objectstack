// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #2567 — anonymous posture must be UNIFORM across HTTP surfaces, not just the
// REST `/data` routes proven by showcase-anonymous-deny.dogfood.test.ts. Before
// this fix, on a `requireAuth` deployment `/data/*` denied anonymous callers
// while three sibling surfaces reached ObjectQL without the gate:
//   - the metadata endpoints (`/meta`)
//   - the raw-hono standard `/data` routes (order-dependent shadowing)
//
// This proof boots the real showcase HTTP stack ON THE PLATFORM DEFAULT (the
// verify harness passes no `requireAuth` override, so the flipped secure default
// is what a fresh production deployment gets) and asserts every surface denies
// an anonymous caller with 401 while an authenticated member is unaffected.

import { describe, it, expect, beforeAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { getSharedShowcase } from './shared-showcase.js';

const OBJ = '/data/showcase_private_note';

describe('showcase: anonymous posture is uniform across surfaces (#2567)', () => {
  let stack: VerifyStack;
  let memberToken: string;

  beforeAll(async () => {
    stack = await getSharedShowcase(); // platform default (deny anonymous)
    await stack.signIn();
    memberToken = await stack.signUp('surfaces-member@verify.test');
  }, 60_000);

  // ── /meta ──────────────────────────────────────────────────────────────
  it('anonymous GET /meta is denied (401)', async () => {
    const r = await stack.api('/meta', { method: 'GET' });
    expect(r.status, 'anonymous metadata read must be 401').toBe(401);
  });

  it('an authenticated member is NOT denied on /meta (deny targets anonymity)', async () => {
    const r = await stack.apiAs(memberToken, 'GET', '/meta');
    expect(r.status, 'authenticated metadata read must clear the auth gate').not.toBe(401);
  });

  // ── /data (surface-level; raw-hono handler proven in plugin-hono-server) ──
  it('anonymous READ of the data surface is denied (401)', async () => {
    const r = await stack.api(OBJ, { method: 'GET' });
    expect(r.status, 'anonymous data read must be 401').toBe(401);
  });

  it('an authenticated member is allowed on the data surface', async () => {
    const r = await stack.apiAs(memberToken, 'GET', OBJ);
    expect(r.status).toBe(200);
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// SHOWCASE proof for ADR-0056 Option A — the `showcase_inquiry` web-to-lead
// PUBLIC FORM. `views/inquiry.view.ts` declares a FormView with
// `sharing.allowAnonymous: true` + `publicLink: '/forms/contact-us'`, which
// wires the anonymous REST endpoints. This exercises them end-to-end over the
// real HTTP stack — the harness boots on the platform DEFAULT, which is now
// secure-by-default deny (ADR-0056 D2 flip), so a passing
// anonymous submit proves the route works under SECURE-BY-DEFAULT auth, with
// NO `guest_portal` profile, authorized solely by the declaration-derived
// `publicFormGrant` (create + read-back on `showcase_inquiry` ONLY).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

describe('showcase: web-to-lead public form (ADR-0056 Option A)', () => {
  let stack: VerifyStack;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets],
      }),
    });
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('GET /forms/:slug returns the form + a whitelisted schema (no auth)', async () => {
    const r = await stack.api('/forms/contact-us');
    expect(r.status, 'anonymous form resolve must succeed').toBe(200);
    const body = (await r.json()) as { object: string; form: unknown; objectSchema: { fields: Record<string, unknown> } };
    expect(body.object).toBe('showcase_inquiry');
    // Only the whitelisted form fields are exposed — server-controlled fields are absent.
    const fields = Object.keys(body.objectSchema.fields);
    expect(fields.sort()).toEqual(['company', 'email', 'message', 'name']);
    expect(fields).not.toContain('status');
    expect(fields).not.toContain('source');
  });

  it('POST /forms/:slug/submit creates an inquiry anonymously under requireAuth (Option A)', async () => {
    const r = await stack.api('/forms/contact-us/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        company: 'Analytical Engines Ltd',
        message: 'Please contact me about a pilot.',
        status: 'closed', // ← not in whitelist → stripped; hook stamps 'new'
      }),
    });
    expect(r.status, 'anonymous submit must succeed under requireAuth=true').toBe(201);
    const body = (await r.json()) as { object: string; id: string; record: Record<string, unknown> };
    expect(body.object).toBe('showcase_inquiry');
    expect(body.record.name).toBe('Ada Lovelace');
    // Server-controlled: whitelist stripped the client `status`, the hook stamped defaults.
    expect(body.record.status, 'status is server-stamped, not client-set').toBe('new');
    expect(body.record.source).toBe('web');
  });

  it('a forged owner_id / organization_id never lands on the row (#3022)', async () => {
    const r = await stack.api('/forms/contact-us/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Mallory',
        email: 'mallory@example.com',
        message: 'Attach this record to the victim.',
        owner_id: 'usr_victim',          // ← ownership forge (#3004-class, no credentials)
        organization_id: 'org_victim',   // ← cross-tenant landing attempt
        created_by: 'usr_victim',
      }),
    });
    expect(r.status, 'the submit itself still succeeds — the anchors are stripped, not fatal').toBe(201);
    const body = (await r.json()) as { record: Record<string, unknown> };
    expect(body.record.name).toBe('Mallory');
    // The anchors are server-managed on this surface: never the forged values.
    expect(body.record.owner_id ?? null, 'anonymous submission must not forge ownership').not.toBe('usr_victim');
    expect(body.record.organization_id ?? null, 'anonymous submission must not land cross-tenant').not.toBe('org_victim');
    expect(body.record.created_by ?? null).not.toBe('usr_victim');
  });

  it('the public grant is create + read-back ONLY — anonymous cannot list inquiries', async () => {
    const r = await stack.api('/data/showcase_inquiry');
    expect(r.status, 'general anonymous read must NOT be opened by the form grant').not.toBe(200);
  });
});

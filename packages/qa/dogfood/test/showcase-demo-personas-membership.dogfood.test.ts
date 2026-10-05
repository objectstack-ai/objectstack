// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The showcase approval-demo personas are raw `sys_user` inserts (the seed in
 * `examples/app-showcase/src/security/seed-approval-demo.ts`), so they never
 * cross the platform's user-creation seam. Under ADR-0093 D7 membership is
 * decided at creation, and the one-time backfill does not pick up users
 * inserted after it ran — so the code that creates them writes their
 * membership. This boot gives the admin a real organization (`orgContext`)
 * and runs the showcase hook, the shape a `pnpm dev:showcase` operator gets.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack, { onEnable } from '@objectstack/example-showcase';
import { ADMIN_EMAIL, PHONE_DEMO_USER, AUDITOR_DEMO_USER } from '@objectstack/example-showcase/security-personas';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { showcaseAppDefaultSecurity } from './showcase-security.js';

const SYS = { isSystem: true } as const;
const showcaseBundleWithHook = { ...(showcaseStack as Record<string, unknown>), onEnable };
const rowsOf = (r: unknown): Array<Record<string, unknown>> =>
  Array.isArray(r) ? (r as Array<Record<string, unknown>>) : ((r as { records?: unknown[] })?.records as Array<Record<string, unknown>>) ?? [];

describe('showcase demo personas are created into the admin\'s organization (ADR-0093 D7)', () => {
  let stack: VerifyStack;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ql: any;

  const membersOf = async (userId: string) =>
    rowsOf(await ql.find('sys_member', { where: { user_id: userId }, limit: 5, context: SYS }));

  /** The persona seed runs on `kernel:bootstrapped`; give it a moment to land. */
  const waitForUser = async (email: string) => {
    for (let i = 0; i < 60; i++) {
      const row = rowsOf(await ql.find('sys_user', { where: { email }, limit: 1, context: SYS }))[0];
      if (row?.id) return row;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`persona ${email} was never provisioned`);
  };

  beforeAll(async () => {
    stack = await bootStack(showcaseBundleWithHook, { security: showcaseAppDefaultSecurity(), orgContext: true });
    await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('each persona holds exactly one plain membership, in the admin\'s organization', async () => {
    const admin = await waitForUser(ADMIN_EMAIL);
    const adminOrgs = (await membersOf(String(admin.id))).map((m) => String(m.organization_id));
    expect(adminOrgs.length, 'PREMISE: the admin is bound to an organization (orgContext)').toBeGreaterThan(0);
    for (const persona of [PHONE_DEMO_USER, AUDITOR_DEMO_USER]) {
      await waitForUser(persona.email);
      const members = await membersOf(persona.id);
      expect(members.length, `${persona.email} has an organization`).toBe(1);
      expect(adminOrgs, `${persona.email} is a member of the admin's organization`).toContain(String(members[0]!.organization_id));
      expect(members[0]!.role, `${persona.email} is a plain member`).toBe('member');
    }
  });
});

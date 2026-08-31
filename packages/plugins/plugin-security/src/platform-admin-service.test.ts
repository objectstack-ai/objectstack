// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * platformAdmin service — the read-only config-derived audit surface
 * (#11974 / #11663 L4, pin #3).
 *
 * With no grant row minted under walled postures, "who are this deployment's
 * platform administrators?" is answered from `OS_PLATFORM_OWNER_EMAIL` (the
 * ONE parser) plus stored `sys_user` rows. These pins hold the surface to the
 * derivation's own semantics: normalized matching, fail-closed verification
 * (absent = unverified), refused-list = zero administrators, and NO writable
 * member.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parsePlatformAdminEmails, resetPlatformAdminEmailMemo } from '@objectstack/core';
import {
  createPlatformAdminService,
  resolvePlatformAdminStanding,
} from './platform-admin-service.js';

function makeQl(users: any[]) {
  return {
    async find(object: string, q: any) {
      if (object !== 'sys_user') return [];
      const where = q?.where ?? {};
      const rows = users.filter((r) =>
        Object.entries(where).every(([k, v]) => {
          if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
          return r[k] === v;
        }),
      );
      // Hold the caller's bound, by PRESENCE (check:objectql-double-limit).
      return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
    },
  };
}

const OLD_OWNER = process.env.OS_PLATFORM_OWNER_EMAIL;
beforeEach(() => {
  delete process.env.OS_PLATFORM_OWNER_EMAIL;
  resetPlatformAdminEmailMemo();
});
afterEach(() => {
  if (OLD_OWNER === undefined) delete process.env.OS_PLATFORM_OWNER_EMAIL;
  else process.env.OS_PLATFORM_OWNER_EMAIL = OLD_OWNER;
  resetPlatformAdminEmailMemo();
});

describe('resolvePlatformAdminStanding — per-entry answer, one implementation for log and service', () => {
  it('reports registered + verified with the standing-holding user id', async () => {
    const config = parsePlatformAdminEmails('ops@corp.example');
    const ql = makeQl([
      { id: 'u1', email: 'ops@corp.example', email_verified: true, created_at: '2026-01-01T00:00:00Z' },
    ]);
    expect(await resolvePlatformAdminStanding(ql, config)).toEqual([
      {
        email: 'ops@corp.example',
        declaredSpelling: 'ops@corp.example',
        registered: true,
        verified: true,
        userId: 'u1',
      },
    ]);
  });

  it('an unverified match is registered but NOT verified, and holds no user id — absent field included', async () => {
    const config = parsePlatformAdminEmails('ops@corp.example, second@corp.example');
    const ql = makeQl([
      { id: 'u1', email: 'ops@corp.example', email_verified: false },
      { id: 'u2', email: 'second@corp.example' }, // imported/legacy: no field ⇒ unverified
    ]);
    const standing = await resolvePlatformAdminStanding(ql, config);
    expect(standing).toEqual([
      { email: 'ops@corp.example', declaredSpelling: 'ops@corp.example', registered: true, verified: false },
      { email: 'second@corp.example', declaredSpelling: 'second@corp.example', registered: true, verified: false },
    ]);
  });

  it('finds a row stored in the operator-typed spelling (imported rows are not lowercased; a driver where is exact)', async () => {
    const config = parsePlatformAdminEmails('Ops@Corp.Example');
    const ql = makeQl([
      // Stored exactly as typed — only the declaredSpelling query can find it.
      { id: 'u1', email: 'Ops@Corp.Example', email_verified: true },
    ]);
    const standing = await resolvePlatformAdminStanding(ql, config);
    expect(standing).toEqual([
      {
        email: 'ops@corp.example',
        declaredSpelling: 'Ops@Corp.Example',
        registered: true,
        verified: true,
        userId: 'u1',
      },
    ]);
  });

  it('an unregistered entry answers registered:false / verified:false', async () => {
    const config = parsePlatformAdminEmails('ops@corp.example');
    expect(await resolvePlatformAdminStanding(makeQl([]), config)).toEqual([
      { email: 'ops@corp.example', declaredSpelling: 'ops@corp.example', registered: false, verified: false },
    ]);
  });

  it('the OLDEST verified account holds standing when several rows match one entry', async () => {
    const config = parsePlatformAdminEmails('ops@corp.example');
    const ql = makeQl([
      { id: 'u_newer', email: 'ops@corp.example', email_verified: true, created_at: '2026-02-01T00:00:00Z' },
      { id: 'u_older', email: 'ops@corp.example', email_verified: true, created_at: '2026-01-01T00:00:00Z' },
    ]);
    const [entry] = await resolvePlatformAdminStanding(ql, config);
    expect(entry!.userId).toBe('u_older');
  });
});

describe('createPlatformAdminService — the registered read-only surface', () => {
  it('configuredEmails(): unset ⇒ undeclared, nothing to list', () => {
    const svc = createPlatformAdminService(() => makeQl([]));
    expect(svc.configuredEmails()).toEqual({ declared: false, refused: false, emails: [] });
  });

  it('configuredEmails(): blank is undeclared (matches the bootstrap pin)', () => {
    process.env.OS_PLATFORM_OWNER_EMAIL = '   ';
    resetPlatformAdminEmailMemo();
    const svc = createPlatformAdminService(() => makeQl([]));
    expect(svc.configuredEmails()).toEqual({ declared: false, refused: false, emails: [] });
  });

  it('configuredEmails(): a declared list serves the normalized, de-duplicated addresses', () => {
    process.env.OS_PLATFORM_OWNER_EMAIL = ' Ops@Corp.Example , second@corp.example ,ops@corp.example';
    resetPlatformAdminEmailMemo();
    const svc = createPlatformAdminService(() => makeQl([]));
    expect(svc.configuredEmails()).toEqual({
      declared: true,
      refused: false,
      emails: ['ops@corp.example', 'second@corp.example'],
    });
  });

  it('configuredEmails(): a REFUSED list is declared + refused with ZERO administrators (Choice 2B, fail-closed whole)', () => {
    process.env.OS_PLATFORM_OWNER_EMAIL = 'ops@corp.example,not-an-email';
    resetPlatformAdminEmailMemo();
    const svc = createPlatformAdminService(() => makeQl([]));
    expect(svc.configuredEmails()).toEqual({ declared: true, refused: true, emails: [] });
  });

  it('standing() serves the same answer as resolvePlatformAdminStanding over the live config', async () => {
    process.env.OS_PLATFORM_OWNER_EMAIL = 'ops@corp.example';
    resetPlatformAdminEmailMemo();
    const svc = createPlatformAdminService(() =>
      makeQl([{ id: 'u1', email: 'ops@corp.example', email_verified: true }]),
    );
    expect(await svc.standing()).toEqual([
      { email: 'ops@corp.example', declaredSpelling: 'ops@corp.example', registered: true, verified: true, userId: 'u1' },
    ]);
  });

  it('standing() throws LOUDLY when objectql is unavailable — an empty list would read as "no administrators"', async () => {
    process.env.OS_PLATFORM_OWNER_EMAIL = 'ops@corp.example';
    resetPlatformAdminEmailMemo();
    const svc = createPlatformAdminService(() => undefined);
    await expect(svc.standing()).rejects.toThrow(/objectql service unavailable/);
  });

  it('the service is frozen and exposes NO writable member — there is no runtime path that changes who is an admin', () => {
    const svc = createPlatformAdminService(() => makeQl([]));
    expect(Object.isFrozen(svc)).toBe(true);
    expect(Object.keys(svc).sort()).toEqual(['configuredEmails', 'standing']);
  });
});

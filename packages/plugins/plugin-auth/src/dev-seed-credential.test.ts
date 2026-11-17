// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The development seed credential rules, unit by unit: which passwords are
 * seed passwords, which doors the pre-lookup refusal reads, and what the
 * verifier answers. The door-level pins are in
 * `dev-seed-credential-production.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEV_SEED_CREDENTIAL_FIELD,
  devSeedCredentialDigest,
  isDevSeedPassword,
  refuseDevSeedPasswordSignIn,
  withDevSeedPasswordRefusal,
} from './dev-seed-credential.js';

const ENV_KEYS = ['NODE_ENV', 'OS_SEED_ADMIN_PASSWORD'] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.NODE_ENV = 'production';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

/** A pair that verifies `password === hash`, counting its calls. */
const plainHasher = () => {
  const verify = vi.fn(async ({ hash, password }: { hash: string; password: string }) => hash === password);
  return { hash: async (password: string) => password, verify };
};

/** An engine whose `sys_user` holds the given stamps. */
const engineWithStamps = (stamps: Record<string, string>) => ({
  find: vi.fn(async (_object: string, query: any) => {
    const wanted = query?.where?.[DEV_SEED_CREDENTIAL_FIELD];
    return Object.entries(stamps)
      .filter(([, stamp]) => stamp === wanted)
      .map(([id]) => ({ id }));
  }),
});

describe('the development seed password', () => {
  it('is admin123, and the value OS_SEED_ADMIN_PASSWORD names when it is set', () => {
    expect(isDevSeedPassword('admin123')).toBe(true);
    expect(isDevSeedPassword('Custom!Seed-1')).toBe(false);
    process.env.OS_SEED_ADMIN_PASSWORD = 'Custom!Seed-1';
    expect(isDevSeedPassword('Custom!Seed-1')).toBe(true);
    expect(isDevSeedPassword('admin123')).toBe(true);
    expect(isDevSeedPassword('')).toBe(false);
    expect(isDevSeedPassword(undefined)).toBe(false);
  });
});

describe('a password sign-in that submits the seed password is refused before any account is read', () => {
  const refusal = (path: string, password: unknown) =>
    refuseDevSeedPasswordSignIn({ path, body: { email: 'a@b.example', password } }).then(
      () => undefined,
      (e: any) => ({ status: e?.statusCode, code: e?.body?.code }),
    );

  it('on every password sign-in door, with 403 PERMISSION_DENIED', async () => {
    for (const path of ['/sign-in/email', '/sign-in/username', '/sign-in/phone-number']) {
      expect(await refusal(path, 'admin123')).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    }
  });

  it('not on another password, another door, or in development mode', async () => {
    expect(await refusal('/sign-in/email', 'S3cure!Passw0rd')).toBeUndefined();
    expect(await refusal('/sign-up/email', 'admin123')).toBeUndefined();
    process.env.NODE_ENV = 'development';
    expect(await refusal('/sign-in/email', 'admin123')).toBeUndefined();
  });
});

describe('the verifier never accepts a seed credential outside development mode', () => {
  it('answers no match for the seed password after running the real verification', async () => {
    const base = plainHasher();
    const verifier = withDevSeedPasswordRefusal(base, { engine: () => engineWithStamps({}) });
    expect(await verifier.verify({ hash: 'admin123', password: 'admin123' })).toBe(false);
    expect(base.verify).toHaveBeenCalledTimes(1);
  });

  it('answers no match for the hash a stamped account still holds from the seed', async () => {
    const engine = engineWithStamps({ usr_seeded: await devSeedCredentialDigest('Custom!Seed-1') });
    const warn = vi.fn();
    const verifier = withDevSeedPasswordRefusal(plainHasher(), { engine: () => engine, logger: () => ({ warn }) });
    expect(await verifier.verify({ hash: 'Custom!Seed-1', password: 'Custom!Seed-1' })).toBe(false);
    expect(warn.mock.calls[0]?.[0]).toContain('os user set-password');
  });

  it('answers a match for any other password, and no match when the stamp cannot be read', async () => {
    const verifier = withDevSeedPasswordRefusal(plainHasher(), { engine: () => engineWithStamps({}) });
    expect(await verifier.verify({ hash: 'S3cure!Passw0rd', password: 'S3cure!Passw0rd' })).toBe(true);
    expect(await verifier.verify({ hash: 'S3cure!Passw0rd', password: 'other' })).toBe(false);
    const failing = withDevSeedPasswordRefusal(plainHasher(), {
      engine: () => ({ find: async () => { throw new Error('store down'); } }),
    });
    expect(await failing.verify({ hash: 'S3cure!Passw0rd', password: 'S3cure!Passw0rd' })).toBe(false);
  });

  it('answers what the underlying verifier answers in development mode', async () => {
    process.env.NODE_ENV = 'development';
    const engine = engineWithStamps({ usr_seeded: await devSeedCredentialDigest('admin123') });
    const verifier = withDevSeedPasswordRefusal(plainHasher(), { engine: () => engine });
    expect(await verifier.verify({ hash: 'admin123', password: 'admin123' })).toBe(true);
    expect(engine.find).not.toHaveBeenCalled();
  });
});

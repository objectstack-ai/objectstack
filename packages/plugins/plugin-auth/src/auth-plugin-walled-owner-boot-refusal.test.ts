// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AuthPlugin init — the fail-closed clause of #11184 (framework leg of
 * cloud#1509; maintainer ruling 2026-08-23, verbatim:
 * 「1509 选择 env 指定 owner 邮箱」).
 *
 * A WALLED tenancy posture (`group` / `isolated`) with no
 * `OS_PLATFORM_OWNER_EMAIL` declared must REFUSE STARTUP, naming the
 * variable — never boot into a state that either can mint no platform admin
 * or tempts a silent fallback to first-registrant elevation. The throw is in
 * `init()`, where a failure aborts kernel boot (Phase 1 propagates).
 *
 * This refusal is a process-boot abort, not an HTTP answer — there is no
 * ADR-0112 envelope to carry `code`/`status`. The machine-checkable pin is
 * the message: it must name the variable (the remedy) and the posture that
 * demanded it, the same shape the ADR-0093 D5 walled fail-fast pins.
 *
 * Both over-denial directions are pinned as positive controls: a walled boot
 * WITH the owner declared initializes, and a `single` boot never consults the
 * variable at all.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthPlugin } from './auth-plugin';
import type { PluginContext } from '@objectstack/core';

const makeCtx = (): PluginContext =>
  ({
    registerService: vi.fn(),
    getService: vi.fn((name: string) => {
      if (name === 'manifest') return { register: vi.fn() };
      return undefined;
    }),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  }) as unknown as PluginContext;

const OLD_POSTURE = process.env.OS_TENANCY_POSTURE;
const OLD_LEGACY = process.env.OS_MULTI_ORG_ENABLED;
const OLD_OWNER = process.env.OS_PLATFORM_OWNER_EMAIL;

beforeEach(() => {
  delete process.env.OS_TENANCY_POSTURE;
  delete process.env.OS_MULTI_ORG_ENABLED;
  delete process.env.OS_PLATFORM_OWNER_EMAIL;
});
afterEach(() => {
  if (OLD_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = OLD_POSTURE;
  if (OLD_LEGACY === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
  else process.env.OS_MULTI_ORG_ENABLED = OLD_LEGACY;
  if (OLD_OWNER === undefined) delete process.env.OS_PLATFORM_OWNER_EMAIL;
  else process.env.OS_PLATFORM_OWNER_EMAIL = OLD_OWNER;
});

const plugin = () => new AuthPlugin({ secret: 'test-secret-at-least-32-chars-long' });

describe('#11184 — walled posture + undeclared owner email refuses startup', () => {
  it("isolated: init rejects, and the message carries the variable (the remedy) and the posture", async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    const err = await plugin()
      .init(makeCtx())
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toContain('OS_PLATFORM_OWNER_EMAIL');
    expect(msg).toContain("'isolated'");
    expect(msg).toContain('Refusing to boot');
    // Never silently reverting is the point — the message says so.
    expect(msg).toContain('first-registrant elevation');
  });

  it('group: the other walled posture refuses identically, naming itself', async () => {
    process.env.OS_TENANCY_POSTURE = 'group';
    const err = await plugin()
      .init(makeCtx())
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('OS_PLATFORM_OWNER_EMAIL');
    expect((err as Error).message).toContain("'group'");
  });

  it('a blank value is undeclared: whitespace does not satisfy the clause', async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = '   ';
    const err = await plugin()
      .init(makeCtx())
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('OS_PLATFORM_OWNER_EMAIL');
  });

  it('the legacy boolean spelling of a walled posture (OS_MULTI_ORG_ENABLED=true) is covered too', async () => {
    process.env.OS_MULTI_ORG_ENABLED = 'true';
    const err = await plugin()
      .init(makeCtx())
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('OS_PLATFORM_OWNER_EMAIL');
  });
});

describe('#11184 — over-denial guards (positive controls)', () => {
  it('walled + declared owner email initializes and registers auth + tenancy', async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = 'operator@corp.example';
    const ctx = makeCtx();
    await plugin().init(ctx);
    const registered = (ctx.registerService as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(registered).toContain('auth');
    expect(registered).toContain('tenancy');
  });

  it('single posture boots with no owner email declared — first-user-is-owner stays as ruled', async () => {
    const ctx = makeCtx();
    await plugin().init(ctx);
    const registered = (ctx.registerService as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(registered).toContain('auth');
    expect(registered).toContain('tenancy');
  });
});

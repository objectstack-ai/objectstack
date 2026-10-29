// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `security` service this plugin registers serves the OPTIONAL
 * `ISecurityService.reopenAudienceBindingSuggestion`, and the served member
 * delegates to this package's `reopenAudienceBindingSuggestion` module
 * function — not to a stub.
 *
 * ## Why this pin exists, and why it is not in `MUST_SERVE_OPTIONAL`
 *
 * The member is optional on the contract, and both mounts of
 * `POST …/suggested-bindings/:id/reopen` feature-detect it: absent, they answer
 * `501` naming the door. That absence fails CLOSED (every dismissal stands and
 * nothing is granted), so it is not the admitting fallback the members pin's
 * `MUST_SERVE_OPTIONAL` list exists for (`registered-security-service-members.pin.test.ts`).
 * But it is a silent loss of a door this plugin ships: the plugin tests call the
 * module function directly, the members pin checks non-vacuity for REQUIRED
 * members only, and the runtime and rest tests use mocks. Without this pin,
 * dropping the wiring in `security-plugin-security-service.ts` would leave every
 * suite green while both routes turned into `501`.
 */

import { describe, it, expect, vi } from 'vitest';

const reopenSpy = vi.hoisted(() => vi.fn());

vi.mock('./suggested-audience-bindings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./suggested-audience-bindings.js')>();
  return { ...actual, reopenAudienceBindingSuggestion: reopenSpy };
});

import { SecurityPlugin } from './security-plugin.js';

/** Boot the real plugin far enough to register `security`, and return what it registered. */
async function registeredSecurityService(): Promise<Record<string, unknown>> {
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: { registerMiddleware: vi.fn(), getSchema: () => undefined },
    metadata: { get: async () => undefined, list: async () => [] },
  };
  const registerService = vi.fn();
  const ctx: Record<string, unknown> = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin();
  await plugin.init(ctx as any);
  await plugin.start(ctx as any);
  const security = registerService.mock.calls.find((c: unknown[]) => c[0] === 'security')?.[1];
  if (security === null || typeof security !== 'object') {
    throw new Error('the plugin did not register a `security` service object');
  }
  return security as Record<string, unknown>;
}

describe('the registered `security` service serves reopenAudienceBindingSuggestion', () => {
  it('serves the member, delegating to the module function with the caller context and id', async () => {
    const security = await registeredSecurityService();
    expect(
      typeof security.reopenAudienceBindingSuggestion,
      'reopenAudienceBindingSuggestion is not served: both reopen routes answer 501',
    ).toBe('function');

    const answer = { suggestion: { id: 'sugg_1', status: 'pending' } };
    reopenSpy.mockResolvedValueOnce(answer);
    const callerContext = { userId: 'u_admin' };
    const reopen = security.reopenAudienceBindingSuggestion as (c: unknown, id: string) => Promise<unknown>;

    await expect(reopen(callerContext, 'sugg_1')).resolves.toBe(answer);
    expect(reopenSpy).toHaveBeenCalledTimes(1);
    const [deps, ctxArg, idArg] = reopenSpy.mock.calls[0]!;
    expect(deps, 'the module function received no suggestion deps').toEqual(expect.objectContaining({ ql: expect.anything() }));
    expect(ctxArg).toBe(callerContext);
    expect(idArg).toBe('sugg_1');
  });
});

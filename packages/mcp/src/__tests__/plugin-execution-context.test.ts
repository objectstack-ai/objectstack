// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ── The stdio ExecutionContext is assembled by the SHARED assembler (#7279) ──
//
// `resolveStdioExecutionContext` was the LAST hand-written `ExecutionContext`
// assembly on the platform: #6216 converged the dispatcher / REST / share-link
// sites onto `assembleExecutionContext` and this face was not in that card's
// inventory at all. Hand assembly is what let it fall behind the envelope in
// two different ways, and this file pins both halves of the convergence plus
// the one deliberate DIVERGENCE it keeps.
//
// ## Why the seam is mocked here, and what that buys
//
// `resolveAuthzContext` and `resolveLocalizationContext` are replaced; the
// assembler itself is NOT (`importActual` keeps it real). The measurement is
// "what does this face hand the data engine, given a resolved principal" — so
// the principal resolution is the input to control and the assembly is the
// thing under test. Mocking the assembler too would leave this file asserting
// its own fixture.
//
// ## The `accessToken` assertion is deliberately NOT a test of unreachability
//
// On the real path `ResolvedAuthzContext.accessToken` cannot arrive here: it is
// assigned only inside `resolve-authz-context.ts`'s
// `if (!userId && typeof input.getSession === 'function')` branch, this call
// passes no `getSession`, and the assembler discards `!userId` anyway. A test
// that let the real resolver decide would therefore be GREEN WHETHER OR NOT the
// field is wired — the vacuity shape. So the mocked envelope carries a sentinel
// token that could not occur in production, and the assertion is that the face
// drops it ANYWAY. That pins the DECISION (withhold a long-lived API-key
// identity from the published `session.accessToken` hook surface) rather than
// the accident, and it fails the moment someone "fixes the omission" by wiring
// `accessToken: authz.accessToken`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';

/** The resolved envelope the API key stands for — the input this face converts. */
const AUTHZ = {
  userId: 'u_stdio',
  tenantId: 'org_stdio',
  email: 'agent@example.com',
  positions: ['sales_rep'],
  permissions: ['records:read'],
  systemPermissions: ['api_access'],
  // Carried by both HTTP faces, dropped by the hand assembly — half of #7279.
  tabPermissions: { crm_account: 'visible', crm_secret: 'hidden' },
  posture: 'member',
  org_user_ids: ['u_stdio', 'u_peer'],
  accessible_org_ids: ['org_stdio', 'org_sibling'],
  // Impossible on this path (see the header) — present so "withheld" is
  // falsifiable instead of vacuous.
  accessToken: 'sess_sentinel_must_not_be_carried',
};

/** The workspace's localization — resolved ONCE by `start()` under #7279. */
const LOCALIZATION = { timezone: 'Asia/Shanghai', locale: 'zh-CN', currency: 'CNY' };

const resolveAuthzContextMock = vi.fn(async () => ({ ...AUTHZ }));
const resolveLocalizationContextMock = vi.fn(async () => ({ ...LOCALIZATION }));

vi.mock('@objectstack/core', async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    resolveAuthzContext: (...args: unknown[]) => resolveAuthzContextMock(...(args as [])),
    resolveLocalizationContext: (...args: unknown[]) =>
      resolveLocalizationContextMock(...(args as [])),
  };
});

const { MCPServerPlugin } = await import('../plugin.js');
const { MCPServerRuntime } = await import('../mcp-server-runtime.js');

interface FindCall {
  object: string;
  options: { context?: ExecutionContext; where?: unknown; limit?: number };
}

function createHarness() {
  const finds: FindCall[] = [];
  const ql = {
    find: vi.fn(async (object: string, options: FindCall['options']) => {
      finds.push({ object, options });
      return [{ id: 'r_1', name: 'Acme' }];
    }),
  };
  const metadata = {
    listObjects: vi.fn(async () => []),
    // No declaration to read ⇒ the ADR-0049 exposure gate falls open, which is
    // the same state a bare kernel is in. This file measures the envelope, not
    // that gate (#8266 owns it).
    getObject: vi.fn(async () => null),
    get: vi.fn(async () => null),
    list: vi.fn(async () => []),
    exists: vi.fn(async () => false),
    getRegisteredTypes: vi.fn(async () => ['object']),
    register: vi.fn(),
    unregister: vi.fn(),
  };
  const settings = { get: vi.fn(async () => undefined) };
  const services: Record<string, unknown> = { objectql: ql, metadata, settings };
  const ctx = {
    registerService: vi.fn(),
    getService: vi.fn((name: string) => {
      if (!(name in services)) throw new Error(`Service "${name}" not found`);
      return services[name];
    }),
    replaceService: vi.fn(),
    getServices: vi.fn(() => new Map(Object.entries(services))),
    hook: vi.fn(),
    trigger: vi.fn(async () => {}),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(() => ({})),
  };
  return { ctx, ql, finds, settings };
}

/**
 * Start the plugin on the stdio path and hand back the principal-bound record
 * reader it registered. The transport itself is stubbed: `start()` would claim
 * this process's stdin/stdout.
 */
async function startStdio(ctx: unknown) {
  let getRecord:
    | ((object: string, id: string) => Promise<Record<string, unknown> | null>)
    | undefined;
  const bridgeResources = vi
    .spyOn(MCPServerRuntime.prototype, 'bridgeResources')
    .mockImplementation((_meta: unknown, reader?: unknown) => {
      getRecord = reader as typeof getRecord;
    });
  const bridgePrompts = vi
    .spyOn(MCPServerRuntime.prototype, 'bridgePrompts')
    .mockImplementation(async () => {});
  const start = vi
    .spyOn(MCPServerRuntime.prototype, 'start')
    .mockImplementation(async () => {});
  try {
    const plugin = new MCPServerPlugin({ autoStart: true });
    await plugin.init(ctx as never);
    await plugin.start(ctx as never);
  } finally {
    bridgeResources.mockRestore();
    bridgePrompts.mockRestore();
    start.mockRestore();
  }
  if (!getRecord) throw new Error('stdio start registered no record reader');
  return getRecord;
}

describe('#7279 — stdio ExecutionContext, assembled by the shared assembler', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.OS_MCP_STDIO_API_KEY = 'osk_test';
    resolveAuthzContextMock.mockClear();
    resolveLocalizationContextMock.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('carries `tabPermissions` — the field the hand assembly dropped', async () => {
    const { ctx, finds } = createHarness();
    const getRecord = await startStdio(ctx);
    await getRecord('crm_account', 'r_1');

    const context = finds[finds.length - 1]!.options.context!;
    expect(context.tabPermissions).toEqual(AUTHZ.tabPermissions);
  });

  it('WITHHOLDS `accessToken` even when the envelope carries one', async () => {
    const { ctx, finds } = createHarness();
    const getRecord = await startStdio(ctx);
    await getRecord('crm_account', 'r_1');

    const context = finds[finds.length - 1]!.options.context!;
    // Absent as a KEY, not merely undefined: the assembler drops undefined
    // values, so a wired-then-empty token and a withheld one would otherwise
    // read the same.
    expect(Object.keys(context)).not.toContain('accessToken');
    expect(JSON.stringify(context)).not.toContain('sess_sentinel_must_not_be_carried');
  });

  it('carries workspace localization — the change with observable output', async () => {
    const { ctx, finds } = createHarness();
    const getRecord = await startStdio(ctx);
    await getRecord('crm_account', 'r_1');

    const context = finds[finds.length - 1]!.options.context!;
    // `timezone` is what moves formula evaluation off the `UTC` default
    // (`cel-engine.ts`: `ctx.timezone ?? 'UTC'`); `locale` is what localizes a
    // denial message instead of rendering it in English.
    expect(context.timezone).toBe('Asia/Shanghai');
    expect(context.locale).toBe('zh-CN');
    expect(context.currency).toBe('CNY');
  });

  it('keeps the fields the hand assembly already carried', async () => {
    const { ctx, finds } = createHarness();
    const getRecord = await startStdio(ctx);
    await getRecord('crm_account', 'r_1');

    const context = finds[finds.length - 1]!.options.context! as ExecutionContext & {
      org_user_ids?: string[];
      accessible_org_ids?: string[];
    };
    expect(context.userId).toBe('u_stdio');
    expect(context.tenantId).toBe('org_stdio');
    expect(context.email).toBe('agent@example.com');
    expect(context.positions).toEqual(['sales_rep']);
    expect(context.permissions).toEqual(['records:read']);
    expect(context.systemPermissions).toEqual(['api_access']);
    expect(context.isSystem).toBe(false);
    expect(context.principalKind).toBe('human');
    expect(context.posture).toBe('member');
    // [ADR-0105 D2] Declared fields now, not `as unknown as` casts.
    expect(context.org_user_ids).toEqual(['u_stdio', 'u_peer']);
    expect(context.accessible_org_ids).toEqual(['org_stdio', 'org_sibling']);
  });

  it('resolves localization ONCE for the transport, not once per read', async () => {
    const { ctx } = createHarness();
    const getRecord = await startStdio(ctx);
    await getRecord('crm_account', 'r_1');
    await getRecord('crm_account', 'r_2');
    await getRecord('crm_account', 'r_3');

    // The #7279 hoist: settings reads are a per-PROCESS cost on a long-lived
    // stdio transport, never a per-call one. This is the assertion that fails
    // if the resolution is moved back inside `resolveStdioExecutionContext`.
    expect(resolveLocalizationContextMock).toHaveBeenCalledTimes(1);
  });

  it('still re-resolves the IDENTITY per read, so key revocation takes effect', async () => {
    const { ctx } = createHarness();
    const getRecord = await startStdio(ctx);
    const afterStart = resolveAuthzContextMock.mock.calls.length;
    await getRecord('crm_account', 'r_1');
    await getRecord('crm_account', 'r_2');

    // The counterweight to the hoist above (ADR-0101 D1): caching localization
    // must NOT become caching the principal. One authz resolution per read.
    expect(resolveAuthzContextMock.mock.calls.length - afterStart).toBe(2);
  });

  it('refuses the read once the key stops resolving to an identity', async () => {
    const { ctx } = createHarness();
    const getRecord = await startStdio(ctx);
    resolveAuthzContextMock.mockImplementationOnce(async () => ({
      ...AUTHZ,
      userId: undefined as unknown as string,
    }));

    // The fail-closed contract is now the assembler's default entry rather than
    // a hand-written guard — same refusal, one implementation.
    await expect(getRecord('crm_account', 'r_1')).rejects.toThrow(/no longer valid/);
  });
});

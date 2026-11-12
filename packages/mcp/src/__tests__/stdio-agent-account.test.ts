// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0151 D3] Over stdio (`OS_MCP_STDIO_API_KEY`, ADR-0101), an AI service
// account's key admits the ACCOUNT as the subject: the context the stdio
// record reader hands the data engine carries `userId` the account,
// `principalKind: 'agent'`, no `onBehalfOf` and no system permission.
//
// Unlike `plugin-execution-context.test.ts`, nothing in `@objectstack/core` is
// mocked here: the REAL `resolveAuthzContext` (key admission, then the grants
// resolver reading the account's `sys_user` row) and the REAL shared assembler
// run over a table double, so the kind is read where production reads it.
// CONTROL: a person's key through the same face is unchanged.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hashApiKey } from '@objectstack/core';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { MCPServerPlugin } from '../plugin.js';
import { MCPServerRuntime } from '../mcp-server-runtime.js';

const FUTURE = '2999-01-01T00:00:00Z';
const BOT_KEY = 'osk_31739_stdio_account';
const MIA_KEY = 'osk_31739_stdio_person';

const TABLES: Record<string, Record<string, unknown>[]> = {
  sys_api_key: [
    { id: 'k_bot', key: hashApiKey(BOT_KEY), revoked: false, user_id: 'u_bot', expires_at: FUTURE, active_organization_id: 'org_a' },
    { id: 'k_mia', key: hashApiKey(MIA_KEY), revoked: false, user_id: 'u_mia', expires_at: FUTURE, active_organization_id: 'org_a' },
  ],
  sys_user: [
    { id: 'u_bot', email: 'bot@agents.invalid', principal_kind: 'agent', accountable_user_id: 'u_mia' },
    { id: 'u_mia', email: 'mia@example.com', principal_kind: 'human' },
  ],
  sys_member: [
    { user_id: 'u_bot', organization_id: 'org_a', role: 'member' },
    { user_id: 'u_mia', organization_id: 'org_a', role: 'member' },
  ],
};

interface FindCall {
  object: string;
  options: { context?: ExecutionContext; where?: Record<string, unknown> };
}

/**
 * Scalar equality only. A combinator or an operator is not implemented here, so
 * it is refused rather than read as a field name.
 */
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$') || (v !== null && typeof v === 'object')) {
      throw new Error(`stdio-agent-account double: unsupported where ${JSON.stringify(where)}`);
    }
    return row[k] === v;
  });
}

function createHarness() {
  const finds: FindCall[] = [];
  const ql = {
    find: vi.fn(async (object: string, options: FindCall['options']) => {
      finds.push({ object, options });
      const rows = TABLES[object];
      if (!rows) return object.startsWith('sys_') ? [] : [{ id: 'r_1', name: 'Acme' }];
      const where = options?.where ?? {};
      return rows.filter((row) => matchesWhere(row, where));
    }),
  };
  const metadata = {
    listObjects: vi.fn(async () => []),
    getObject: vi.fn(async () => null),
    get: vi.fn(async () => null),
    list: vi.fn(async () => []),
    exists: vi.fn(async () => false),
    getRegisteredTypes: vi.fn(async () => ['object']),
    register: vi.fn(),
    unregister: vi.fn(),
  };
  const services: Record<string, unknown> = { objectql: ql, metadata, settings: { get: vi.fn(async () => undefined) } };
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
  return { ctx, finds };
}

/** Start the plugin on the stdio path and hand back the principal-bound record reader (transport stubbed). */
async function startStdio(ctx: unknown) {
  let getRecord: ((object: string, id: string) => Promise<Record<string, unknown> | null>) | undefined;
  const bridgeResources = vi
    .spyOn(MCPServerRuntime.prototype, 'bridgeResources')
    .mockImplementation((_meta: unknown, reader?: unknown) => {
      getRecord = reader as typeof getRecord;
    });
  const bridgePrompts = vi.spyOn(MCPServerRuntime.prototype, 'bridgePrompts').mockImplementation(async () => {});
  const start = vi.spyOn(MCPServerRuntime.prototype, 'start').mockImplementation(async () => {});
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

/** The context the stdio face handed the engine for one record read with `key`. */
async function contextFor(key: string): Promise<ExecutionContext> {
  process.env.OS_MCP_STDIO_API_KEY = key;
  const { ctx, finds } = createHarness();
  const getRecord = await startStdio(ctx);
  await getRecord('crm_account', 'r_1');
  const read = finds.filter((f) => f.object === 'crm_account').at(-1);
  if (!read?.options.context) throw new Error('the record read carried no context');
  return read.options.context;
}

describe('[ADR-0151 D3] stdio: an AI service account\'s key admits the account itself', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = { ...originalEnv }; });

  it('userId is the account, principalKind agent, no onBehalfOf, no system permission, no everyone anchor', async () => {
    const context = await contextFor(BOT_KEY);
    expect(context.userId).toBe('u_bot');
    expect(context.principalKind).toBe('agent');
    expect(context.onBehalfOf).toBeUndefined();
    expect(Object.keys(context)).not.toContain('onBehalfOf');
    expect(context.systemPermissions).toEqual([]);
    expect(context.positions).not.toContain('everyone');
    expect(context.isSystem).toBe(false);
  });

  it('[ADR-0151 D3 rule 3] stdio serves an account no action door, so no stdio call confirms an action for it', async () => {
    // The account rule lives at the action doors (`run_action`, `resume_run`,
    // REST `/actions`, a host door), pinned in `@objectstack/runtime`. Over
    // stdio the account's tools are the bridge registered here; this holds
    // that it carries no action seam, so an action door that ever joins stdio
    // fails here first and is asked to carry the rule.
    process.env.OS_MCP_STDIO_API_KEY = BOT_KEY;
    const { ctx } = createHarness();
    let bridge: Record<string, unknown> | undefined;
    const bridgeDataTools = vi
      .spyOn(MCPServerRuntime.prototype, 'bridgeDataTools')
      .mockImplementation((b: unknown) => { bridge = b as Record<string, unknown>; return []; });
    try {
      await startStdio(ctx);
    } finally {
      bridgeDataTools.mockRestore();
    }
    expect(bridge, 'stdio registered no data bridge').toBeDefined();
    expect(typeof bridge!.listObjects).toBe('function');
    for (const seam of ['listActions', 'runAction', 'resumeRun']) {
      expect(typeof bridge![seam], `stdio now carries \`${seam}\``).toBe('undefined');
    }
  });

  it('CONTROL: a person\'s key through the same face is a human principal, with the everyone anchor', async () => {
    const context = await contextFor(MIA_KEY);
    expect(context.userId).toBe('u_mia');
    expect(context.principalKind).toBe('human');
    expect(context.onBehalfOf).toBeUndefined();
    expect(context.positions).toContain('everyone');
  });
});

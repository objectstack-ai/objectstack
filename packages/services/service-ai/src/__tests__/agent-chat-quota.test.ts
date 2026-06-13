// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import type { IDataEngine, Logger } from '@objectstack/spec/contracts';
import { DailyMessageQuota, type AgentChatQuota } from '../quota/agent-chat-quota.js';
import { buildAgentRoutes } from '../routes/agent-routes.js';
import { AIService } from '../ai-service.js';
import { MemoryLLMAdapter } from '../adapters/memory-adapter.js';
import { InMemoryConversationService } from '../conversation/in-memory-conversation-service.js';
import type { AgentRuntime } from '../agent-runtime.js';

const silentLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
};

const FIXED_NOW = () => new Date('2026-06-12T10:00:00.000Z');

function mockDataEngine(rows: Record<string, { messages: number }> = {}): IDataEngine & {
  inserted: unknown[];
  updated: unknown[];
} {
  const inserted: unknown[] = [];
  const updated: unknown[] = [];
  return {
    inserted,
    updated,
    findOne: vi.fn(async (_obj: string, q?: { where?: { id?: string } }) => {
      const id = q?.where?.id;
      return id && rows[id] ? { id, ...rows[id] } : null;
    }),
    insert: vi.fn(async (_obj: string, data: unknown) => {
      inserted.push(data);
      return data;
    }),
    update: vi.fn(async (_obj: string, data: unknown, opts: unknown) => {
      updated.push({ data, opts });
      return data;
    }),
    find: vi.fn(async () => []),
    delete: vi.fn(async () => ({})),
    count: vi.fn(async () => 0),
    aggregate: vi.fn(async () => []),
  } as unknown as IDataEngine & { inserted: unknown[]; updated: unknown[] };
}

// ═══════════════════════════════════════════════════════════════════
// DailyMessageQuota
// ═══════════════════════════════════════════════════════════════════

describe('DailyMessageQuota', () => {
  const subject = { userId: 'u1', environmentId: 'env1' };
  const todayId = '2026-06-12:env1:u1';

  it('allows under the limit and reports remaining + resetAt', async () => {
    const quota = new DailyMessageQuota(mockDataEngine({ [todayId]: { messages: 3 } }), 30, FIXED_NOW);
    const d = await quota.check(subject);
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(26); // 30 - 3 - this turn
    expect(d.resetAt).toBe('2026-06-13T00:00:00.000Z');
  });

  it('refuses at the limit with honest copy (why + when + way out)', async () => {
    const quota = new DailyMessageQuota(mockDataEngine({ [todayId]: { messages: 30 } }), 30, FIXED_NOW);
    const d = await quota.check(subject);
    expect(d.allowed).toBe(false);
    expect(d.resetAt).toBe('2026-06-13T00:00:00.000Z');
    expect(d.message).toContain('30');
    expect(d.message).toContain('恢复');
    expect(d.message).toContain('upgrade');
  });

  it('consume inserts the first turn of the day, then increments', async () => {
    const engine = mockDataEngine();
    const quota = new DailyMessageQuota(engine, 30, FIXED_NOW);
    await quota.consume(subject);
    expect(engine.inserted).toEqual([
      { id: todayId, day: '2026-06-12', user_id: 'u1', environment_id: 'env1', messages: 1 },
    ]);

    const engine2 = mockDataEngine({ [todayId]: { messages: 5 } });
    const quota2 = new DailyMessageQuota(engine2, 30, FIXED_NOW);
    await quota2.consume(subject);
    expect(engine2.updated).toEqual([{ data: { messages: 6 }, opts: { where: { id: todayId } } }]);
  });

  it('fails OPEN when the counter store errors — never blocks chat', async () => {
    const engine = mockDataEngine();
    (engine.findOne as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));
    const quota = new DailyMessageQuota(engine, 1, FIXED_NOW);
    await expect(quota.check(subject)).resolves.toMatchObject({ allowed: true });
    await expect(quota.consume(subject)).resolves.toBeUndefined();
  });

  it('scopes the counter per environment and per user', async () => {
    const engine = mockDataEngine({ ['2026-06-12:envA:u1']: { messages: 99 } });
    const quota = new DailyMessageQuota(engine, 10, FIXED_NOW);
    // Same user, different environment → independent counter.
    expect((await quota.check({ userId: 'u1', environmentId: 'envB' })).allowed).toBe(true);
    // Different user, same environment → independent counter.
    expect((await quota.check({ userId: 'u2', environmentId: 'envA' })).allowed).toBe(true);
    // The exhausted pair stays refused.
    expect((await quota.check({ userId: 'u1', environmentId: 'envA' })).allowed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Agent chat route × quota gate
// ═══════════════════════════════════════════════════════════════════

function mockAgentRuntime(): AgentRuntime {
  return {
    loadAgent: vi.fn(async () => ({
      name: 'data_chat',
      label: 'Assistant',
      active: true,
    })),
    resolveActiveSkills: vi.fn(async () => []),
    buildSystemMessages: vi.fn(() => [{ role: 'system', content: 'sys' }]),
    buildContextSchemaMessages: vi.fn(async () => []),
    buildRequestOptions: vi.fn(() => ({})),
    listAgents: vi.fn(async () => []),
  } as unknown as AgentRuntime;
}

function chatRoute(quota?: AgentChatQuota) {
  const aiService = new AIService({
    adapter: new MemoryLLMAdapter(),
    conversationService: new InMemoryConversationService(),
  });
  const routes = buildAgentRoutes(aiService, mockAgentRuntime(), silentLogger, { quota });
  const route = routes.find((r) => r.path.endsWith('/chat'));
  if (!route) throw new Error('chat route not found');
  return route;
}

const chatReq = (over: Record<string, unknown> = {}) => ({
  params: { agentName: 'data_chat' },
  body: { messages: [{ role: 'user', content: 'hi' }], stream: false, ...over },
  user: { userId: 'u1' },
});

describe('agent chat route quota gate', () => {
  it('passes through and consumes exactly once when allowed', async () => {
    const quota: AgentChatQuota = {
      check: vi.fn(async () => ({ allowed: true })),
      consume: vi.fn(async () => {}),
    };
    const res = await chatRoute(quota).handler(chatReq() as never);
    expect(res.status).toBe(200);
    expect(quota.check).toHaveBeenCalledTimes(1);
    expect(quota.consume).toHaveBeenCalledTimes(1);
  });

  it('returns 429 + stable code on JSON mode when exhausted (nothing consumed)', async () => {
    const quota: AgentChatQuota = {
      check: vi.fn(async () => ({ allowed: false, message: '额度已用完', resetAt: '2026-06-13T00:00:00.000Z' })),
      consume: vi.fn(async () => {}),
    };
    const res = await chatRoute(quota).handler(chatReq() as never);
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'ai_quota_exhausted', error: '额度已用完', resetAt: '2026-06-13T00:00:00.000Z' });
    expect(quota.consume).not.toHaveBeenCalled();
  });

  it('streams the refusal as a normal assistant message in stream mode', async () => {
    const quota: AgentChatQuota = {
      check: vi.fn(async () => ({ allowed: false, message: '今日额度已用完,明日恢复' })),
      consume: vi.fn(async () => {}),
    };
    const res = await chatRoute(quota).handler(chatReq({ stream: true }) as never);
    expect(res.status).toBe(200);
    expect(res.stream).toBe(true);
    let text = '';
    for await (const chunk of res.events as AsyncIterable<string>) text += chunk;
    expect(text).toContain('今日额度已用完');
    expect(text).toContain('"type":"finish"');
    expect(quota.consume).not.toHaveBeenCalled();
  });

  it('no quota wired → unchanged behavior', async () => {
    const res = await chatRoute(undefined).handler(chatReq() as never);
    expect(res.status).toBe(200);
  });

  it('forwards the environmentId from chat context to the quota subject', async () => {
    const quota: AgentChatQuota = {
      check: vi.fn(async () => ({ allowed: true })),
      consume: vi.fn(async () => {}),
    };
    await chatRoute(quota).handler(chatReq({ context: { environmentId: 'env42' } }) as never);
    expect(quota.check).toHaveBeenCalledWith({ userId: 'u1', environmentId: 'env42' });
    expect(quota.consume).toHaveBeenCalledWith({ userId: 'u1', environmentId: 'env42' });
  });
});

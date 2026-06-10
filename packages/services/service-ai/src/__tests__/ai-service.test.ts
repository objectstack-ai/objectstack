// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ModelMessage, IAIService, TextStreamPart, ToolSet } from '@objectstack/spec/contracts';
import { AIService } from '../ai-service.js';
import { MemoryLLMAdapter } from '../adapters/memory-adapter.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { InMemoryConversationService } from '../conversation/in-memory-conversation-service.js';
import { buildAIRoutes } from '../routes/ai-routes.js';
import { AIServicePlugin } from '../plugin.js';
import type { LLMAdapter } from '@objectstack/spec/contracts';

// Suppress logger output in tests
const silentLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as any;

// ─────────────────────────────────────────────────────────────────
// MemoryLLMAdapter
// ─────────────────────────────────────────────────────────────────

describe('MemoryLLMAdapter', () => {
  let adapter: MemoryLLMAdapter;

  beforeEach(() => {
    adapter = new MemoryLLMAdapter();
  });

  it('should have name "memory"', () => {
    expect(adapter.name).toBe('memory');
  });

  it('should echo the last user message in chat()', async () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello AI' },
    ];
    const result = await adapter.chat(messages);
    expect(result.content).toBe('[memory] Hello AI');
    expect(result.model).toBe('memory');
    expect(result.usage).toBeDefined();
  });

  it('should handle no user message in chat()', async () => {
    const messages: ModelMessage[] = [{ role: 'system', content: 'System only' }];
    const result = await adapter.chat(messages);
    expect(result.content).toBe('[memory] (no user message)');
  });

  it('should echo prompt in complete()', async () => {
    const result = await adapter.complete('test prompt');
    expect(result.content).toBe('[memory] test prompt');
  });

  it('should stream word-by-word in streamChat()', async () => {
    const messages: ModelMessage[] = [{ role: 'user', content: 'Hi there' }];
    const events: TextStreamPart<ToolSet>[] = [];
    for await (const event of adapter.streamChat(messages)) {
      events.push(event);
    }
    // "[memory]" + " Hi" + " there" = 3 text-delta events + 1 finish
    expect(events.filter(e => e.type === 'text-delta').length).toBeGreaterThan(0);
    expect(events[events.length - 1].type).toBe('finish');
  });

  it('should return zero vectors for embed()', async () => {
    const result = await adapter.embed(['hello', 'world']);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual([0, 0, 0]);
  });

  it('should list memory model', async () => {
    const models = await adapter.listModels();
    expect(models).toEqual(['memory']);
  });
});

// ─────────────────────────────────────────────────────────────────
// ToolRegistry
// ─────────────────────────────────────────────────────────────────

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('should register and retrieve a tool', () => {
    const def = { name: 'test_tool', description: 'A test', parameters: {} };
    registry.register(def, async () => 'result');
    expect(registry.has('test_tool')).toBe(true);
    expect(registry.getDefinition('test_tool')).toEqual(def);
    expect(registry.size).toBe(1);
    expect(registry.names()).toEqual(['test_tool']);
  });

  it('should unregister a tool', () => {
    registry.register({ name: 'tool_a', description: 'A', parameters: {} }, async () => '');
    registry.unregister('tool_a');
    expect(registry.has('tool_a')).toBe(false);
    expect(registry.size).toBe(0);
  });

  it('should execute a tool call', async () => {
    registry.register(
      { name: 'add', description: 'Add numbers', parameters: {} },
      async (args) => String((args.a as number) + (args.b as number)),
    );

    const result = await registry.execute({
      type: 'tool-call',
      toolCallId: 'call_1',
      toolName: 'add',
      input: { a: 3, b: 4 },
    });

    expect(result.toolCallId).toBe('call_1');
    expect(result.output).toEqual({ type: 'text', value: '7' });
    expect(result.isError).toBeUndefined();
  });

  it('should return error for unknown tool', async () => {
    const result = await registry.execute({
      type: 'tool-call',
      toolCallId: 'call_x',
      toolName: 'unknown',
      input: {},
    });
    expect(result.isError).toBe(true);
    expect(result.output).toEqual(expect.objectContaining({ type: 'text', value: expect.stringContaining('not registered') }));
  });

  it('should return error on handler failure', async () => {
    registry.register(
      { name: 'fail_tool', description: 'Fails', parameters: {} },
      async () => { throw new Error('boom'); },
    );

    const result = await registry.execute({
      type: 'tool-call',
      toolCallId: 'call_f',
      toolName: 'fail_tool',
      input: {},
    });
    expect(result.isError).toBe(true);
    expect(result.output).toEqual({ type: 'text', value: 'boom' });
  });

  it('should execute multiple tool calls in parallel', async () => {
    registry.register(
      { name: 'echo', description: 'Echo', parameters: {} },
      async (args) => args.msg as string,
    );

    const results = await registry.executeAll([
      { type: 'tool-call', toolCallId: 'c1', toolName: 'echo', input: { msg: 'a' } },
      { type: 'tool-call', toolCallId: 'c2', toolName: 'echo', input: { msg: 'b' } },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].output).toEqual({ type: 'text', value: 'a' });
    expect(results[1].output).toEqual({ type: 'text', value: 'b' });
  });

  it('should return all definitions', () => {
    registry.register({ name: 't1', description: 'T1', parameters: {} }, async () => '');
    registry.register({ name: 't2', description: 'T2', parameters: {} }, async () => '');
    expect(registry.getAll()).toHaveLength(2);
  });

  it('should clear all tools', () => {
    registry.register({ name: 'x', description: 'X', parameters: {} }, async () => '');
    registry.clear();
    expect(registry.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// InMemoryConversationService
// ─────────────────────────────────────────────────────────────────

describe('InMemoryConversationService', () => {
  let svc: InMemoryConversationService;

  beforeEach(() => {
    svc = new InMemoryConversationService();
  });

  it('should create a conversation', async () => {
    const conv = await svc.create({ title: 'Test', userId: 'u1' });
    expect(conv.id).toBeDefined();
    expect(conv.title).toBe('Test');
    expect(conv.userId).toBe('u1');
    expect(conv.messages).toHaveLength(0);
    expect(conv.createdAt).toBeDefined();
  });

  it('should get a conversation by ID', async () => {
    const created = await svc.create({ title: 'Lookup' });
    const found = await svc.get(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);

    const missing = await svc.get('nonexistent');
    expect(missing).toBeNull();
  });

  it('should list conversations with filters', async () => {
    await svc.create({ userId: 'a', agentId: 'ag1' });
    await svc.create({ userId: 'b', agentId: 'ag1' });
    await svc.create({ userId: 'a', agentId: 'ag2' });

    expect((await svc.list()).length).toBe(3);
    expect((await svc.list({ userId: 'a' })).length).toBe(2);
    expect((await svc.list({ agentId: 'ag1' })).length).toBe(2);
    expect((await svc.list({ limit: 1 })).length).toBe(1);
  });

  it('should add messages to a conversation', async () => {
    const conv = await svc.create({});
    await svc.addMessage(conv.id, { role: 'user', content: 'Hi' });
    const updated = await svc.addMessage(conv.id, { role: 'assistant', content: 'Hello!' });
    expect(updated.messages).toHaveLength(2);
  });

  it('should throw when adding message to non-existent conversation', async () => {
    await expect(
      svc.addMessage('nope', { role: 'user', content: 'Hi' }),
    ).rejects.toThrow('not found');
  });

  it('should delete a conversation', async () => {
    const conv = await svc.create({});
    await svc.delete(conv.id);
    expect(await svc.get(conv.id)).toBeNull();
  });

  it('should track size', async () => {
    expect(svc.size).toBe(0);
    await svc.create({});
    expect(svc.size).toBe(1);
  });

  it('should clear all conversations', async () => {
    await svc.create({});
    await svc.create({});
    svc.clear();
    expect(svc.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// AIService (Orchestrator)
// ─────────────────────────────────────────────────────────────────

describe('AIService', () => {
  it('should use MemoryLLMAdapter by default', async () => {
    const service = new AIService({ logger: silentLogger });
    expect(service.adapterName).toBe('memory');

    const result = await service.chat([{ role: 'user', content: 'Hi' }]);
    expect(result.content).toBe('[memory] Hi');
  });

  it('should delegate complete() to adapter', async () => {
    const service = new AIService({ logger: silentLogger });
    const result = await service.complete('test');
    expect(result.content).toBe('[memory] test');
  });

  it('should stream via adapter.streamChat()', async () => {
    const service = new AIService({ logger: silentLogger });
    const events: TextStreamPart<ToolSet>[] = [];
    for await (const event of service.streamChat([{ role: 'user', content: 'Hi' }])) {
      events.push(event);
    }
    expect(events.length).toBeGreaterThan(1);
    expect(events[events.length - 1].type).toBe('finish');
  });

  it('should fall back to non-streaming when adapter has no streamChat', async () => {
    const adapter: LLMAdapter = {
      name: 'no-stream',
      chat: async () => ({ content: 'response', model: 'test' }),
      complete: async () => ({ content: '' }),
      // no streamChat
    };
    const service = new AIService({ adapter, logger: silentLogger });

    const events: TextStreamPart<ToolSet>[] = [];
    for await (const event of service.streamChat([{ role: 'user', content: 'Hi' }])) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('text-delta');
    expect(events[0].type === 'text-delta' && events[0].text).toBe('response');
    expect(events[1].type).toBe('finish');
  });

  it('should delegate embed() to adapter', async () => {
    const service = new AIService({ logger: silentLogger });
    const embeddings = await service.embed('hello');
    expect(embeddings).toHaveLength(1);
  });

  it('should throw when adapter does not support embed()', async () => {
    const adapter: LLMAdapter = {
      name: 'no-embed',
      chat: async () => ({ content: '' }),
      complete: async () => ({ content: '' }),
    };
    const service = new AIService({ adapter, logger: silentLogger });
    await expect(service.embed('hello')).rejects.toThrow('does not support embeddings');
  });

  it('should delegate listModels() to adapter', async () => {
    const service = new AIService({ logger: silentLogger });
    const models = await service.listModels();
    expect(models).toEqual(['memory']);
  });

  it('should return empty array when adapter has no listModels()', async () => {
    const adapter: LLMAdapter = {
      name: 'no-models',
      chat: async () => ({ content: '' }),
      complete: async () => ({ content: '' }),
    };
    const service = new AIService({ adapter, logger: silentLogger });
    const models = await service.listModels();
    expect(models).toEqual([]);
  });

  it('should expose toolRegistry and conversationService', () => {
    const service = new AIService({ logger: silentLogger });
    expect(service.toolRegistry).toBeInstanceOf(ToolRegistry);
    expect(service.conversationService).toBeInstanceOf(InMemoryConversationService);
  });

  it('should accept custom adapter', async () => {
    const customAdapter: LLMAdapter = {
      name: 'custom',
      chat: async () => ({ content: 'custom response' }),
      complete: async (p) => ({ content: `custom: ${p}` }),
    };
    const service = new AIService({ adapter: customAdapter, logger: silentLogger });
    expect(service.adapterName).toBe('custom');

    const result = await service.chat([{ role: 'user', content: 'test' }]);
    expect(result.content).toBe('custom response');
  });

  // ─── Auto-persist chat history when conversationId is supplied ───

  it('chatWithTools auto-persists user + assistant turns when conversationId is provided', async () => {
    const conversationService = new InMemoryConversationService();
    const adapter: LLMAdapter = {
      name: 'persist-test',
      chat: async () => ({ content: 'hello back', model: 'test' }),
      complete: async () => ({ content: '' }),
    };
    const service = new AIService({ adapter, conversationService, logger: silentLogger });
    const conv = await conversationService.create();

    await service.chatWithTools(
      [{ role: 'user', content: 'hi' }],
      { toolExecutionContext: { conversationId: conv.id } },
    );

    const after = await conversationService.get(conv.id);
    expect(after?.messages).toHaveLength(2);
    expect(after?.messages[0].role).toBe('user');
    expect(after?.messages[1].role).toBe('assistant');
    expect(after?.messages[1].content).toBe('hello back');
  });

  it('chatWithTools persists assistant + tool turns across iterations', async () => {
    const conversationService = new InMemoryConversationService();
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(
      { name: 'echo', description: 'echo', parameters: {} as any },
      async (input: any) => ({ ok: true, input }),
    );

    let calls = 0;
    const adapter: LLMAdapter = {
      name: 'tool-persist-test',
      chat: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            content: '',
            model: 'test',
            toolCalls: [
              { type: 'tool-call' as const, toolCallId: 'tc_1', toolName: 'echo', input: { x: 1 } },
            ],
          };
        }
        return { content: 'done', model: 'test' };
      },
      complete: async () => ({ content: '' }),
    };
    const service = new AIService({ adapter, conversationService, toolRegistry, logger: silentLogger });
    const conv = await conversationService.create();

    await service.chatWithTools(
      [{ role: 'user', content: 'use echo' }],
      { toolExecutionContext: { conversationId: conv.id } },
    );

    const after = await conversationService.get(conv.id);
    expect(after?.messages).toHaveLength(4);
    expect(after?.messages.map(m => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
  });

  it('streamChatWithTools drains a tool\'s onProgress events into the stream, before its result', async () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: 'build', description: 'B', parameters: {} },
      async (_args, ctx) => {
        // A long-running tool reporting progress mid-execution.
        ctx?.onProgress?.({ type: 'data-build-progress', id: 'b', data: { phase: 'objects', done: 1 } });
        ctx?.onProgress?.({ type: 'data-build-progress', id: 'b', data: { phase: 'seed', done: 2 } });
        return 'built';
      },
    );
    let calls = 0;
    const adapter: LLMAdapter = {
      name: 'progress-test',
      chat: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            content: '',
            model: 'test',
            toolCalls: [{ type: 'tool-call' as const, toolCallId: 'tc1', toolName: 'build', input: {} }],
          };
        }
        return { content: 'done', model: 'test' };
      },
      complete: async () => ({ content: '' }),
    };
    const service = new AIService({ adapter, toolRegistry: registry, logger: silentLogger });

    const events: TextStreamPart<ToolSet>[] = [];
    for await (const ev of service.streamChatWithTools([{ role: 'user', content: 'build' }])) {
      events.push(ev);
    }

    const progress = events.filter((e) => (e as { type: string }).type === 'data-build-progress');
    expect(progress).toHaveLength(2);
    expect((progress[0] as any).data).toMatchObject({ phase: 'objects' });
    expect((progress[1] as any).data).toMatchObject({ phase: 'seed' });
    // Progress surfaces BEFORE the tool-result (the whole point — mid-execution).
    const firstProgress = events.findIndex((e) => (e as { type: string }).type === 'data-build-progress');
    const toolResult = events.findIndex((e) => (e as { type: string }).type === 'tool-result');
    expect(firstProgress).toBeLessThan(toolResult);
  });

  it('streamChatWithTools auto-persists user + assistant turns when conversationId is provided', async () => {
    const conversationService = new InMemoryConversationService();
    const adapter: LLMAdapter = {
      name: 'stream-persist-test',
      chat: async () => ({ content: 'streamed reply', model: 'test' }),
      complete: async () => ({ content: '' }),
    };
    const service = new AIService({ adapter, conversationService, logger: silentLogger });
    const conv = await conversationService.create();

    const events: TextStreamPart<ToolSet>[] = [];
    for await (const ev of service.streamChatWithTools(
      [{ role: 'user', content: 'hi' }],
      { toolExecutionContext: { conversationId: conv.id } },
    )) {
      events.push(ev);
    }

    const after = await conversationService.get(conv.id);
    expect(after?.messages).toHaveLength(2);
    expect(after?.messages[0].role).toBe('user');
    expect(after?.messages[1].role).toBe('assistant');
    expect(after?.messages[1].content).toBe('streamed reply');
  });

  it('does not persist when conversationId is omitted', async () => {
    const conversationService = new InMemoryConversationService();
    const spy = vi.spyOn(conversationService, 'addMessage');
    const adapter: LLMAdapter = {
      name: 'no-persist-test',
      chat: async () => ({ content: 'reply', model: 'test' }),
      complete: async () => ({ content: '' }),
    };
    const service = new AIService({ adapter, conversationService, logger: silentLogger });

    await service.chatWithTools([{ role: 'user', content: 'hi' }]);

    expect(spy).not.toHaveBeenCalled();
  });

  it('swallows persistence errors and still returns the assistant reply', async () => {
    const conversationService = new InMemoryConversationService();
    vi.spyOn(conversationService, 'addMessage').mockRejectedValue(new Error('boom'));
    const adapter: LLMAdapter = {
      name: 'persist-fail-test',
      chat: async () => ({ content: 'still ok', model: 'test' }),
      complete: async () => ({ content: '' }),
    };
    const service = new AIService({ adapter, conversationService, logger: silentLogger });

    const result = await service.chatWithTools(
      [{ role: 'user', content: 'hi' }],
      { toolExecutionContext: { conversationId: 'missing-id' } },
    );
    expect(result.content).toBe('still ok');
  });
});

// ─────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────

describe('AI Routes', () => {
  let service: AIService;

  beforeEach(() => {
    service = new AIService({ logger: silentLogger });
  });

  it('should build all expected routes', () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    expect(routes.length).toBe(10);

    const paths = routes.map(r => `${r.method} ${r.path}`);
    expect(paths).toContain('POST /api/v1/ai/chat');
    expect(paths).toContain('POST /api/v1/ai/chat/stream');
    expect(paths).toContain('POST /api/v1/ai/complete');
    expect(paths).toContain('GET /api/v1/ai/models');
    expect(paths).toContain('POST /api/v1/ai/conversations');
    expect(paths).toContain('GET /api/v1/ai/conversations');
    expect(paths).toContain('GET /api/v1/ai/conversations/:id');
    expect(paths).toContain('POST /api/v1/ai/conversations/:id/messages');
    expect(paths).toContain('PATCH /api/v1/ai/conversations/:id');
    expect(paths).toContain('DELETE /api/v1/ai/conversations/:id');
  });

  it('POST /api/v1/ai/chat should return JSON result when stream=false', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const chatRoute = routes.find(r => r.path === '/api/v1/ai/chat')!;

    const response = await chatRoute.handler({
      body: { messages: [{ role: 'user', content: 'Hi' }], stream: false },
    });

    expect(response.status).toBe(200);
    expect((response.body as any).content).toBe('[memory] Hi');
  });

  it('POST /api/v1/ai/chat should default to Vercel Data Stream mode', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const chatRoute = routes.find(r => r.path === '/api/v1/ai/chat')!;

    const response = await chatRoute.handler({
      body: { messages: [{ role: 'user', content: 'Hi' }] },
    });

    expect(response.status).toBe(200);
    expect(response.stream).toBe(true);
    expect(response.vercelDataStream).toBe(true);
    expect(response.events).toBeDefined();

    // Consume the Vercel Data Stream events
    const events: unknown[] = [];
    for await (const event of response.events!) {
      events.push(event);
    }
    expect(events.length).toBeGreaterThan(0);
  });

  it('POST /api/v1/ai/chat should prepend systemPrompt as system message', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const chatRoute = routes.find(r => r.path === '/api/v1/ai/chat')!;

    const response = await chatRoute.handler({
      body: {
        messages: [{ role: 'user', content: 'Hello' }],
        system: 'You are a helpful assistant',
        stream: false,
      },
    });

    expect(response.status).toBe(200);
    // MemoryLLMAdapter echoes the last user message
    expect((response.body as any).content).toBe('[memory] Hello');
  });

  it('POST /api/v1/ai/chat should accept deprecated systemPrompt field', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const chatRoute = routes.find(r => r.path === '/api/v1/ai/chat')!;

    const response = await chatRoute.handler({
      body: {
        messages: [{ role: 'user', content: 'Hi' }],
        systemPrompt: 'Be concise',
        stream: false,
      },
    });

    expect(response.status).toBe(200);
    expect((response.body as any).content).toBe('[memory] Hi');
  });

  it('POST /api/v1/ai/chat should accept flat Vercel-style fields (model, temperature)', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const chatRoute = routes.find(r => r.path === '/api/v1/ai/chat')!;

    const response = await chatRoute.handler({
      body: {
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'gpt-4o',
        temperature: 0.5,
        stream: false,
      },
    });

    expect(response.status).toBe(200);
    // MemoryLLMAdapter uses the model from options when provided
    expect((response.body as any).model).toBe('gpt-4o');
  });

  it('POST /api/v1/ai/chat should accept array content (Vercel multi-part)', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const chatRoute = routes.find(r => r.path === '/api/v1/ai/chat')!;

    const response = await chatRoute.handler({
      body: {
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        stream: false,
      },
    });

    // MemoryLLMAdapter falls back to "(complex content)" for non-string
    expect(response.status).toBe(200);
    expect((response.body as any).content).toBe('[memory] (complex content)');
  });

  it('POST /api/v1/ai/chat should return 400 without messages', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const chatRoute = routes.find(r => r.path === '/api/v1/ai/chat')!;

    const response = await chatRoute.handler({ body: {} });
    expect(response.status).toBe(400);
  });

  it('POST /api/v1/ai/chat/stream should return streaming response', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const streamRoute = routes.find(r => r.path === '/api/v1/ai/chat/stream')!;

    const response = await streamRoute.handler({
      body: { messages: [{ role: 'user', content: 'Hello' }] },
    });

    expect(response.status).toBe(200);
    expect(response.stream).toBe(true);
    expect(response.events).toBeDefined();

    // Consume the stream
    const events: unknown[] = [];
    for await (const event of response.events!) {
      events.push(event);
    }
    expect(events.length).toBeGreaterThan(0);
  });

  it('POST /api/v1/ai/complete should return completion result', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const completeRoute = routes.find(r => r.path === '/api/v1/ai/complete')!;

    const response = await completeRoute.handler({
      body: { prompt: 'test prompt' },
    });

    expect(response.status).toBe(200);
    expect((response.body as any).content).toBe('[memory] test prompt');
  });

  it('POST /api/v1/ai/complete should return 400 without prompt', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const completeRoute = routes.find(r => r.path === '/api/v1/ai/complete')!;

    const response = await completeRoute.handler({ body: {} });
    expect(response.status).toBe(400);
  });

  it('GET /api/v1/ai/models should return model list', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const modelsRoute = routes.find(r => r.path === '/api/v1/ai/models')!;

    const response = await modelsRoute.handler({});
    expect(response.status).toBe(200);
    expect((response.body as any).models).toContain('memory');
  });

  it('POST /api/v1/ai/conversations should create conversation', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const createRoute = routes.find(r => r.method === 'POST' && r.path === '/api/v1/ai/conversations')!;

    const response = await createRoute.handler({
      body: { title: 'Test Conv', userId: 'u1' },
    });

    expect(response.status).toBe(201);
    expect((response.body as any).title).toBe('Test Conv');
  });

  it('GET /api/v1/ai/conversations should list conversations', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const createRoute = routes.find(r => r.method === 'POST' && r.path === '/api/v1/ai/conversations')!;
    const listRoute = routes.find(r => r.method === 'GET' && r.path === '/api/v1/ai/conversations')!;

    await createRoute.handler({ body: { title: 'C1' } });
    await createRoute.handler({ body: { title: 'C2' } });

    const response = await listRoute.handler({});
    expect(response.status).toBe(200);
    expect((response.body as any).conversations).toHaveLength(2);
  });

  it('POST /api/v1/ai/conversations/:id/messages should add message', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const createRoute = routes.find(r => r.method === 'POST' && r.path === '/api/v1/ai/conversations')!;
    const addMsgRoute = routes.find(r => r.path === '/api/v1/ai/conversations/:id/messages')!;

    const created = await createRoute.handler({ body: {} });
    const convId = (created.body as any).id;

    const response = await addMsgRoute.handler({
      params: { id: convId },
      body: { role: 'user', content: 'Hi there' },
    });

    expect(response.status).toBe(200);
    expect((response.body as any).messages).toHaveLength(1);
  });

  it('POST /api/v1/ai/conversations/:id/messages should return 404 for unknown conversation', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const addMsgRoute = routes.find(r => r.path === '/api/v1/ai/conversations/:id/messages')!;

    const response = await addMsgRoute.handler({
      params: { id: 'unknown' },
      body: { role: 'user', content: 'Hi' },
    });

    expect(response.status).toBe(404);
  });

  it('DELETE /api/v1/ai/conversations/:id should delete conversation', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const createRoute = routes.find(r => r.method === 'POST' && r.path === '/api/v1/ai/conversations')!;
    const deleteRoute = routes.find(r => r.method === 'DELETE' && r.path === '/api/v1/ai/conversations/:id')!;

    const created = await createRoute.handler({ body: {} });
    const convId = (created.body as any).id;

    const response = await deleteRoute.handler({ params: { id: convId } });
    expect(response.status).toBe(204);
  });

  // ── Message validation ───────────────────────────────────────

  it('POST /api/v1/ai/chat should return 400 for messages with invalid role', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const chatRoute = routes.find(r => r.path === '/api/v1/ai/chat')!;

    const response = await chatRoute.handler({
      body: { messages: [{ role: 'invalid', content: 'Hi' }] },
    });

    expect(response.status).toBe(400);
    expect((response.body as any).error).toContain('message.role');
  });

  it('POST /api/v1/ai/chat should return 400 for messages with non-string/non-array content', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const chatRoute = routes.find(r => r.path === '/api/v1/ai/chat')!;

    // Numeric content should be rejected
    const response = await chatRoute.handler({
      body: { messages: [{ role: 'user', content: 123 }] },
    });
    expect(response.status).toBe(400);
    expect((response.body as any).error).toContain('content');

    // Object content (not an array) should be rejected
    const response2 = await chatRoute.handler({
      body: { messages: [{ role: 'user', content: { nested: true } }] },
    });
    expect(response2.status).toBe(400);
    expect((response2.body as any).error).toContain('content');

    // Boolean content should be rejected
    const response3 = await chatRoute.handler({
      body: { messages: [{ role: 'user', content: true }] },
    });
    expect(response3.status).toBe(400);
    expect((response3.body as any).error).toContain('content');
  });

  it('POST /api/v1/ai/conversations/:id/messages should return 400 for invalid role', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const createRoute = routes.find(r => r.method === 'POST' && r.path === '/api/v1/ai/conversations')!;
    const addMsgRoute = routes.find(r => r.path === '/api/v1/ai/conversations/:id/messages')!;

    const created = await createRoute.handler({ body: {} });
    const convId = (created.body as any).id;

    const response = await addMsgRoute.handler({
      params: { id: convId },
      body: { role: 'invalid_role', content: 'Hi' },
    });

    expect(response.status).toBe(400);
    expect((response.body as any).error).toContain('message.role');
  });

  it('POST /api/v1/ai/conversations/:id/messages should return 400 for missing content', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const addMsgRoute = routes.find(r => r.path === '/api/v1/ai/conversations/:id/messages')!;

    const response = await addMsgRoute.handler({
      params: { id: 'conv_1' },
      body: { role: 'user' },
    });

    expect(response.status).toBe(400);
    expect((response.body as any).error).toContain('content');
  });

  // ── Limit parsing ───────────────────────────────────────────

  it('GET /api/v1/ai/conversations should parse limit from query string', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const createRoute = routes.find(r => r.method === 'POST' && r.path === '/api/v1/ai/conversations')!;
    const listRoute = routes.find(r => r.method === 'GET' && r.path === '/api/v1/ai/conversations')!;

    await createRoute.handler({ body: { title: 'C1' } });
    await createRoute.handler({ body: { title: 'C2' } });
    await createRoute.handler({ body: { title: 'C3' } });

    const response = await listRoute.handler({ query: { limit: '2' } });
    expect(response.status).toBe(200);
    expect((response.body as any).conversations).toHaveLength(2);
  });

  it('GET /api/v1/ai/conversations should return 400 for invalid limit', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const listRoute = routes.find(r => r.method === 'GET' && r.path === '/api/v1/ai/conversations')!;

    const response = await listRoute.handler({ query: { limit: 'abc' } });
    expect(response.status).toBe(400);
    expect((response.body as any).error).toContain('limit');
  });

  it('GET /api/v1/ai/conversations should return 400 for negative limit', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const listRoute = routes.find(r => r.method === 'GET' && r.path === '/api/v1/ai/conversations')!;

    const response = await listRoute.handler({ query: { limit: '-1' } });
    expect(response.status).toBe(400);
    expect((response.body as any).error).toContain('limit');
  });

  // ── Tool message in chat ────────────────────────────────────

  it('POST /api/v1/ai/chat should accept tool role messages', async () => {
    const routes = buildAIRoutes(service, service.conversationService, silentLogger);
    const chatRoute = routes.find(r => r.path === '/api/v1/ai/chat')!;

    const response = await chatRoute.handler({
      body: {
        messages: [
          { role: 'user', content: 'What is the weather?' },
          { role: 'assistant', content: '' },
          { role: 'tool', content: '{"temp": 22}', toolCallId: 'call_1' },
        ],
        stream: false,
      },
    });

    expect(response.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────
// AIServicePlugin (Integration)
// ─────────────────────────────────────────────────────────────────

describe('AIServicePlugin', () => {
  function createMockContext() {
    const services = new Map<string, unknown>();
    const hooks = new Map<string, Function[]>();

    // Pre-register manifest service
    services.set('manifest', { register: vi.fn() });

    return {
      registerService: vi.fn((name: string, service: unknown) => services.set(name, service)),
      replaceService: vi.fn((name: string, service: unknown) => services.set(name, service)),
      getService: vi.fn(<T>(name: string): T => {
        if (!services.has(name)) throw new Error(`Service "${name}" not found`);
        return services.get(name) as T;
      }),
      getServices: vi.fn(() => services),
      hook: vi.fn((name: string, handler: Function) => {
        if (!hooks.has(name)) hooks.set(name, []);
        hooks.get(name)!.push(handler);
      }),
      trigger: vi.fn(async () => {}),
      logger: silentLogger,
      getKernel: vi.fn(),
    } as any;
  }

  it('should register as "ai" service on init', async () => {
    const plugin = new AIServicePlugin();
    const ctx = createMockContext();

    await plugin.init(ctx);

    expect(ctx.registerService).toHaveBeenCalledWith('ai', expect.any(Object));
    const service = ctx.getService<IAIService>('ai');
    expect(service).toBeDefined();
    expect(typeof service.chat).toBe('function');
  });

  it('should have correct plugin metadata', () => {
    const plugin = new AIServicePlugin();
    expect(plugin.name).toBe('com.objectstack.service-ai');
    expect(plugin.version).toBe('1.0.0');
    expect(plugin.type).toBe('standard');
  });

  it('should trigger ai:ready on start', async () => {
    const plugin = new AIServicePlugin();
    const ctx = createMockContext();

    await plugin.init(ctx);
    await plugin.start!(ctx);

    expect(ctx.trigger).toHaveBeenCalledWith('ai:ready', expect.any(Object));
    expect(ctx.trigger).toHaveBeenCalledWith('ai:routes', expect.any(Array));
  });

  it('should use custom adapter when provided', async () => {
    const customAdapter: LLMAdapter = {
      name: 'custom-test',
      chat: async () => ({ content: 'custom' }),
      complete: async () => ({ content: '' }),
    };

    const plugin = new AIServicePlugin({ adapter: customAdapter });
    const ctx = createMockContext();

    await plugin.init(ctx);

    const service = ctx.getService<AIService>('ai');
    expect(service.adapterName).toBe('custom-test');
  });

  it('should replace existing AI service', async () => {
    const plugin = new AIServicePlugin();
    const ctx = createMockContext();

    // Pre-register a mock AI service
    ctx.registerService('ai', { chat: vi.fn(), complete: vi.fn() });

    await plugin.init(ctx);

    expect(ctx.replaceService).toHaveBeenCalledWith('ai', expect.any(Object));
  });

  it('SETUP_APP no longer contains an AI area (moved to dedicated AI app)', async () => {
    // AI Conversations / Messages were originally in the platform Setup App,
    // but per product direction the AI surface gets its own dedicated app
    // (developed separately) — so the Setup App should NOT carry an
    // `area_ai` block anymore. This test guards against accidental
    // re-introduction.
    const { SETUP_APP } = await import('@objectstack/platform-objects/apps');
    const aiArea = SETUP_APP.areas?.find((a: any) => a.id === 'area_ai');
    expect(aiArea).toBeUndefined();
  });

  it('should clean up on destroy', async () => {
    const plugin = new AIServicePlugin();
    const ctx = createMockContext();

    await plugin.init(ctx);
    await plugin.destroy!();

    // After destroy, the plugin should not throw
    // (internal service reference cleared)
  });

  it('should register debug hook when debug=true', async () => {
    const plugin = new AIServicePlugin({ debug: true });
    const ctx = createMockContext();

    await plugin.init(ctx);

    expect(ctx.hook).toHaveBeenCalledWith('ai:beforeChat', expect.any(Function));
  });

  // ── LLM Provider Auto-Detection ─────────────────────────────────

  it('should use MemoryLLMAdapter when no env vars are set', async () => {
    const plugin = new AIServicePlugin();
    const ctx = createMockContext();

    // Ensure no LLM provider env vars are set
    const oldEnv = { ...process.env };
    delete process.env.AI_GATEWAY_MODEL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    try {
      await plugin.init(ctx);

      const service = ctx.getService<AIService>('ai');
      expect(service.adapterName).toBe('memory');

      // Verify warning was logged
      expect(silentLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No LLM provider configured')
      );
    } finally {
      // Restore environment
      process.env = oldEnv;
    }
  });

  it('should fallback to MemoryLLMAdapter when provider SDK is not installed', async () => {
    // Mock all provider SDKs to simulate them not being installed.
    // In the workspace @ai-sdk/openai may be resolvable as a transitive
    // dependency, so we must explicitly make the dynamic import fail.
    vi.doMock('@ai-sdk/openai', () => { throw new Error('Cannot find module \'@ai-sdk/openai\''); });
    vi.doMock('@ai-sdk/anthropic', () => { throw new Error('Cannot find module \'@ai-sdk/anthropic\''); });
    vi.doMock('@ai-sdk/google', () => { throw new Error('Cannot find module \'@ai-sdk/google\''); });

    // Re-import the plugin module so it picks up the mocked imports
    const { AIServicePlugin: FreshPlugin } = await import('../plugin.js');
    const plugin = new FreshPlugin();
    const ctx = createMockContext();

    const oldEnv = { ...process.env };
    // Set env var, but the SDK won't be available in test environment
    process.env.OPENAI_API_KEY = 'fake-openai-key';
    delete process.env.AI_GATEWAY_MODEL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    try {
      await plugin.init(ctx);

      const service = ctx.getService<AIService>('ai');
      // Should fall back to memory because @ai-sdk/openai is not installed
      expect(service.adapterName).toBe('memory');

      // Verify warning was logged about SDK load failure
      expect(silentLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load @ai-sdk/openai'),
        expect.objectContaining({ error: expect.any(String) })
      );

      // Verify warning was logged about final fallback
      expect(silentLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No LLM provider configured')
      );
    } finally {
      process.env = oldEnv;
      vi.doUnmock('@ai-sdk/openai');
      vi.doUnmock('@ai-sdk/anthropic');
      vi.doUnmock('@ai-sdk/google');
    }
  });

  it('should prefer the gatewayModel option over the AI_GATEWAY_MODEL env var', async () => {
    // Mock the gateway SDK to fail so detection falls through deterministically;
    // the warn message echoes the CHOSEN model, letting us assert precedence.
    vi.doMock('@ai-sdk/gateway', () => { throw new Error("Cannot find module '@ai-sdk/gateway'"); });
    const { AIServicePlugin: FreshPlugin } = await import('../plugin.js');
    const plugin = new FreshPlugin({ gatewayModel: 'anthropic/claude-haiku-4-5' });
    const ctx = createMockContext();

    const oldEnv = { ...process.env };
    process.env.AI_GATEWAY_MODEL = 'openai/gpt-5.5';
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    try {
      await plugin.init(ctx);
      // The option's model must be the one attempted, not the env var's.
      expect(silentLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('anthropic/claude-haiku-4-5'),
        expect.anything(),
      );
      expect(silentLogger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('openai/gpt-5.5'),
        expect.anything(),
      );
    } finally {
      process.env = oldEnv;
      vi.doUnmock('@ai-sdk/gateway');
    }
  });

  it('should fall back to AI_GATEWAY_MODEL env when no gatewayModel option is set', async () => {
    vi.doMock('@ai-sdk/gateway', () => { throw new Error("Cannot find module '@ai-sdk/gateway'"); });
    const { AIServicePlugin: FreshPlugin } = await import('../plugin.js');
    const plugin = new FreshPlugin();
    const ctx = createMockContext();

    const oldEnv = { ...process.env };
    process.env.AI_GATEWAY_MODEL = 'anthropic/claude-sonnet-4-5';
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    try {
      await plugin.init(ctx);
      expect(silentLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('anthropic/claude-sonnet-4-5'),
        expect.anything(),
      );
    } finally {
      process.env = oldEnv;
      vi.doUnmock('@ai-sdk/gateway');
    }
  });

  it('should prefer explicit adapter over auto-detection', async () => {
    const customAdapter: LLMAdapter = {
      name: 'custom-explicit',
      chat: async () => ({ content: 'explicit' }),
      complete: async () => ({ content: '' }),
    };

    const plugin = new AIServicePlugin({ adapter: customAdapter });
    const ctx = createMockContext();

    const oldEnv = { ...process.env };
    process.env.OPENAI_API_KEY = 'fake-openai-key';

    try {
      await plugin.init(ctx);

      const service = ctx.getService<AIService>('ai');
      expect(service.adapterName).toBe('custom-explicit');

      // Verify it logged as explicitly configured
      expect(silentLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('explicitly configured')
      );
    } finally {
      process.env = oldEnv;
    }
  });

  it('should log adapter selection', async () => {
    const plugin = new AIServicePlugin();
    const ctx = createMockContext();

    const oldEnv = { ...process.env };
    delete process.env.AI_GATEWAY_MODEL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    try {
      await plugin.init(ctx);

      // Verify adapter selection was logged
      expect(silentLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Using LLM adapter')
      );
    } finally {
      process.env = oldEnv;
    }
  });

  // ── settings binding ─────────────────────────────────────────────
  describe('settings binding', () => {
    function createCtxWithSettings(settings: any) {
      const ctx = createMockContext();
      // expose settings via the same getService mock
      (ctx as any).getServices().set('settings', settings);
      return ctx;
    }

    it('AIService.setAdapter swaps the active adapter', () => {
      const a: LLMAdapter = { name: 'a', chat: async () => ({ content: 'a' }), complete: async () => ({ content: '' }) };
      const b: LLMAdapter = { name: 'b', chat: async () => ({ content: 'b' }), complete: async () => ({ content: '' }) };
      const svc = new AIService({ adapter: a, logger: silentLogger });
      expect(svc.adapterName).toBe('a');
      svc.setAdapter(b);
      expect(svc.adapterName).toBe('b');
    });

    it('does not bind to settings when bindToSettings=false', async () => {
      const settings = {
        getNamespace: vi.fn(),
        subscribe: vi.fn(),
        registerAction: vi.fn(),
      };
      const plugin = new AIServicePlugin({ bindToSettings: false });
      const ctx = createCtxWithSettings(settings);
      await plugin.init(ctx);
      await plugin.start!(ctx);
      // No kernel:ready hook registered for settings binding
      const kernelReadyHooks = (ctx.hook as any).mock.calls.filter(([n]: any[]) => n === 'kernel:ready');
      expect(kernelReadyHooks.length).toBe(0);
    });

    it('binds to settings, applies values, subscribes, and registers live test action', async () => {
      const customAdapter: LLMAdapter = {
        name: 'preset', chat: async () => ({ content: 'preset' }), complete: async () => ({ content: '' }),
      };
      const settings = {
        getNamespace: vi.fn(async () => ({
          manifest: { namespace: 'ai' },
          values: { provider: { value: 'memory' } },
        })),
        subscribe: vi.fn(),
        registerAction: vi.fn(),
      };
      const plugin = new AIServicePlugin({ adapter: customAdapter });
      const ctx = createCtxWithSettings(settings);
      await plugin.init(ctx);
      await plugin.start!(ctx);

      // Find and invoke the kernel:ready hook that does settings binding
      const kernelReady = (ctx.hook as any).mock.calls.find(([n]: any[]) => n === 'kernel:ready');
      expect(kernelReady).toBeDefined();
      await kernelReady[1]();

      expect(settings.getNamespace).toHaveBeenCalledWith('ai');
      expect(settings.subscribe).toHaveBeenCalledWith('ai', expect.any(Function));
      expect(settings.registerAction).toHaveBeenCalledWith('ai', 'test', expect.any(Function));

      // memory provider is no-op overlay → original adapter retained
      const svc = ctx.getService<AIService>('ai');
      expect(svc.adapterName).toBe('preset');
    });

    it('treats stored memory provider as an explicit settings override', async () => {
      const customAdapter: LLMAdapter = {
        name: 'preset', chat: async () => ({ content: 'preset' }), complete: async () => ({ content: '' }),
      };
      const settings = {
        getNamespace: vi.fn(async () => ({
          manifest: { namespace: 'ai' },
          values: { provider: { value: 'memory', source: 'global' } },
        })),
        subscribe: vi.fn(),
        registerAction: vi.fn(),
      };
      const plugin = new AIServicePlugin({ adapter: customAdapter });
      const ctx = createCtxWithSettings(settings);
      await plugin.init(ctx);
      await plugin.start!(ctx);

      const kernelReady = (ctx.hook as any).mock.calls.find(([n]: any[]) => n === 'kernel:ready');
      await kernelReady[1]();

      const svc = ctx.getService<AIService>('ai');
      expect(svc.adapterName).toBe('memory');
    });

    it('live test action returns warning for memory provider', async () => {
      const settings: any = {
        getNamespace: vi.fn(async () => ({ manifest: { namespace: 'ai' }, values: {} })),
        subscribe: vi.fn(),
        registerAction: vi.fn(),
      };
      const plugin = new AIServicePlugin();
      const ctx = createCtxWithSettings(settings);
      await plugin.init(ctx);
      await plugin.start!(ctx);
      const kernelReady = (ctx.hook as any).mock.calls.find(([n]: any[]) => n === 'kernel:ready');
      await kernelReady[1]();

      const handler = settings.registerAction.mock.calls.find((c: any[]) => c[0] === 'ai' && c[1] === 'test')[2];
      const result = await handler({ values: {}, payload: { values: { provider: 'memory' } } });
      expect(result.ok).toBe(true);
      expect(result.severity).toBe('warning');
      expect(result.message).toContain('echo stub');
    });

    it('live test action reports missing api key for openai', async () => {
      const settings: any = {
        getNamespace: vi.fn(async () => ({ manifest: { namespace: 'ai' }, values: {} })),
        subscribe: vi.fn(),
        registerAction: vi.fn(),
      };
      const plugin = new AIServicePlugin();
      const ctx = createCtxWithSettings(settings);
      await plugin.init(ctx);
      await plugin.start!(ctx);
      const kernelReady = (ctx.hook as any).mock.calls.find(([n]: any[]) => n === 'kernel:ready');
      await kernelReady[1]();
      const handler = settings.registerAction.mock.calls.find((c: any[]) => c[0] === 'ai' && c[1] === 'test')[2];
      const result = await handler({ values: {}, payload: { values: { provider: 'openai' } } });
      expect(result.ok).toBe(false);
      expect(result.severity).toBe('error');
    });
  });

  // ── embedder binding ────────────────────────────────────────────
  describe('embedder binding', () => {
    function createCtxWithSettings(settings: any) {
      const services = new Map<string, unknown>();
      services.set('manifest', { register: vi.fn() });
      services.set('settings', settings);
      return {
        registerService: vi.fn((name: string, service: unknown) => services.set(name, service)),
        replaceService: vi.fn((name: string, service: unknown) => services.set(name, service)),
        getService: vi.fn(<T,>(name: string): T => {
          if (!services.has(name)) throw new Error(`Service "${name}" not found`);
          return services.get(name) as T;
        }),
        getServices: vi.fn(() => services),
        hook: vi.fn(),
        trigger: vi.fn(async () => {}),
        logger: silentLogger,
        getKernel: vi.fn(),
      } as any;
    }

    it('registers ai/test_embedder live action alongside ai/test', async () => {
      const settings: any = {
        getNamespace: vi.fn(async () => ({ manifest: { namespace: 'ai' }, values: {} })),
        subscribe: vi.fn(),
        registerAction: vi.fn(),
      };
      const plugin = new AIServicePlugin();
      const ctx = createCtxWithSettings(settings);
      await plugin.init(ctx);
      await plugin.start!(ctx);
      const kernelReady = (ctx.hook as any).mock.calls.find(([n]: any[]) => n === 'kernel:ready');
      await kernelReady[1]();
      const actionIds = settings.registerAction.mock.calls.map((c: any[]) => `${c[0]}/${c[1]}`);
      expect(actionIds).toContain('ai/test');
      expect(actionIds).toContain('ai/test_embedder');
    });

    it('test_embedder action returns warning when provider=none', async () => {
      const settings: any = {
        getNamespace: vi.fn(async () => ({ manifest: { namespace: 'ai' }, values: {} })),
        subscribe: vi.fn(),
        registerAction: vi.fn(),
      };
      const plugin = new AIServicePlugin();
      const ctx = createCtxWithSettings(settings);
      await plugin.init(ctx);
      await plugin.start!(ctx);
      const kernelReady = (ctx.hook as any).mock.calls.find(([n]: any[]) => n === 'kernel:ready');
      await kernelReady[1]();
      const handler = settings.registerAction.mock.calls.find(
        (c: any[]) => c[0] === 'ai' && c[1] === 'test_embedder',
      )[2];
      const result = await handler({ values: {}, payload: { values: { embedder_provider: 'none' } } });
      expect(result.ok).toBe(false);
      expect(result.severity).toBe('warning');
    });

    it('test_embedder action reports missing api key for siliconflow', async () => {
      const settings: any = {
        getNamespace: vi.fn(async () => ({ manifest: { namespace: 'ai' }, values: {} })),
        subscribe: vi.fn(),
        registerAction: vi.fn(),
      };
      const plugin = new AIServicePlugin();
      const ctx = createCtxWithSettings(settings);
      await plugin.init(ctx);
      await plugin.start!(ctx);
      const kernelReady = (ctx.hook as any).mock.calls.find(([n]: any[]) => n === 'kernel:ready');
      await kernelReady[1]();
      const handler = settings.registerAction.mock.calls.find(
        (c: any[]) => c[0] === 'ai' && c[1] === 'test_embedder',
      )[2];
      const result = await handler({
        values: {},
        payload: { values: { embedder_provider: 'siliconflow' } },
      });
      expect(result.ok).toBe(false);
      expect(result.severity).toBe('error');
    });

    it('test_embedder action rejects custom provider without base URL', async () => {
      const settings: any = {
        getNamespace: vi.fn(async () => ({ manifest: { namespace: 'ai' }, values: {} })),
        subscribe: vi.fn(),
        registerAction: vi.fn(),
      };
      const plugin = new AIServicePlugin();
      const ctx = createCtxWithSettings(settings);
      await plugin.init(ctx);
      await plugin.start!(ctx);
      const kernelReady = (ctx.hook as any).mock.calls.find(([n]: any[]) => n === 'kernel:ready');
      await kernelReady[1]();
      const handler = settings.registerAction.mock.calls.find(
        (c: any[]) => c[0] === 'ai' && c[1] === 'test_embedder',
      )[2];
      const result = await handler({
        values: {},
        payload: { values: { embedder_provider: 'custom', embedder_api_key: 'k' } },
      });
      expect(result.ok).toBe(false);
      expect(result.severity).toBe('error');
    });

    it('builds and registers embedder via EMBEDDER_SERVICE when provider is configured', async () => {
      // Stub global fetch so OpenAIEmbedder.embed() succeeds.
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [{ embedding: Array.from({ length: 1024 }, () => 0.01) }],
        }),
      })) as any;
      try {
        const settings: any = {
          getNamespace: vi.fn(async () => ({
            manifest: { namespace: 'ai' },
            values: {
              embedder_provider: { value: 'siliconflow' },
              embedder_api_key: { value: 'sk-test' },
              embedder_model: { value: 'BAAI/bge-m3' },
            },
          })),
          subscribe: vi.fn(),
          registerAction: vi.fn(),
        };
        const plugin = new AIServicePlugin();
        const ctx = createCtxWithSettings(settings);
        await plugin.init(ctx);
        await plugin.start!(ctx);
        const kernelReady = (ctx.hook as any).mock.calls.find(([n]: any[]) => n === 'kernel:ready');
        await kernelReady[1]();
        // EMBEDDER_SERVICE registered
        const services = ctx.getServices();
        const embedder = services.get('embedder') as any;
        expect(embedder).toBeDefined();
        expect(embedder.id).toBe('siliconflow');
        expect(embedder.dimensions).toBe(1024);
        // Live action round-trip
        const handler = settings.registerAction.mock.calls.find(
          (c: any[]) => c[0] === 'ai' && c[1] === 'test_embedder',
        )[2];
        const result = await handler({
          values: {},
          payload: {
            values: {
              embedder_provider: 'siliconflow',
              embedder_api_key: 'sk-test',
              embedder_model: 'BAAI/bge-m3',
            },
          },
        });
        expect(result.ok).toBe(true);
        expect(result.message).toContain('vector dims=1024');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Conversation auto-titling
  // ─────────────────────────────────────────────────────────────────

  describe('conversation auto-titling', () => {
    /**
     * Test adapter that returns a fixed `chat()` response for each call,
     * cycling through `responses`. Lets us script the "first call =
     * assistant turn, second call = title" sequence used by these tests.
     */
    function makeScriptedAdapter(responses: string[]): LLMAdapter {
      let i = 0;
      return {
        name: 'scripted',
        async chat() {
          const content = responses[Math.min(i, responses.length - 1)] ?? '';
          i++;
          return {
            content,
            toolCalls: undefined,
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            model: 'scripted',
          };
        },
      } as unknown as LLMAdapter;
    }

    /** Wait for fire-and-forget summarizeConversation to settle. */
    async function flushMicrotasks(): Promise<void> {
      // Two tick rounds is enough: one for the void promise to resolve
      // the adapter call, one for the update to land.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    }

    it('does not generate a title when feature is disabled (default)', async () => {
      const adapter = makeScriptedAdapter(['Sure, here is a reply.']);
      const conversationService = new InMemoryConversationService();
      const service = new AIService({ adapter, conversationService, logger: silentLogger });
      const conv = await conversationService.create();

      await service.chatWithTools(
        [{ role: 'user', content: 'Help me design a database schema' } as ModelMessage],
        { toolExecutionContext: { conversationId: conv.id } } as any,
      );
      await flushMicrotasks();

      const after = await conversationService.get(conv.id);
      expect(after?.title ?? undefined).toBeUndefined();
    });

    it('auto-titles the conversation after the first assistant turn when enabled', async () => {
      const adapter = makeScriptedAdapter([
        'Here is a brief overview of database normalization...',
        'Database Schema',
      ]);
      const conversationService = new InMemoryConversationService();
      const service = new AIService({ adapter, conversationService, logger: silentLogger });
      service.setTitleGenerationConfig({ enabled: true, maxLength: 24 });

      const conv = await conversationService.create();
      await service.chatWithTools(
        [{ role: 'user', content: 'Help me design a database schema' } as ModelMessage],
        { toolExecutionContext: { conversationId: conv.id } } as any,
      );
      await flushMicrotasks();

      const after = await conversationService.get(conv.id);
      expect(after?.title).toBe('Database Schema');
    });

    it('does not retitle a conversation that already has a title', async () => {
      const adapter = makeScriptedAdapter([
        'Reply.',
        'This Should Not Land',
      ]);
      const conversationService = new InMemoryConversationService();
      const service = new AIService({ adapter, conversationService, logger: silentLogger });
      service.setTitleGenerationConfig({ enabled: true, maxLength: 24 });

      const conv = await conversationService.create({ title: 'Manually Named' });
      await service.chatWithTools(
        [{ role: 'user', content: 'Hello' } as ModelMessage],
        { toolExecutionContext: { conversationId: conv.id } } as any,
      );
      await flushMicrotasks();

      const after = await conversationService.get(conv.id);
      expect(after?.title).toBe('Manually Named');
    });

    it('skips titling when there is no user message in the conversation', async () => {
      const adapter = makeScriptedAdapter(['Reply.', 'Should Not Be Used']);
      const conversationService = new InMemoryConversationService();
      const service = new AIService({ adapter, conversationService, logger: silentLogger });
      service.setTitleGenerationConfig({ enabled: true, maxLength: 24 });

      const conv = await conversationService.create();
      // No persistence wired — the in-memory conv stays empty even after run.
      // Call summarize directly to assert the empty-history guard.
      await service.summarizeConversation(conv.id);

      const after = await conversationService.get(conv.id);
      expect(after?.title ?? undefined).toBeUndefined();
    });

    it('cleans up common model artifacts (quotes, prefixes, trailing period)', async () => {
      const adapter = makeScriptedAdapter([
        'Sure!',
        '  "Title: Database Schema Design."  ',
      ]);
      const conversationService = new InMemoryConversationService();
      const service = new AIService({ adapter, conversationService, logger: silentLogger });
      service.setTitleGenerationConfig({ enabled: true, maxLength: 32 });

      const conv = await conversationService.create();
      await service.chatWithTools(
        [{ role: 'user', content: 'design a schema' } as ModelMessage],
        { toolExecutionContext: { conversationId: conv.id } } as any,
      );
      await flushMicrotasks();

      const after = await conversationService.get(conv.id);
      expect(after?.title).toBe('Database Schema Design');
    });

    it('hard-caps title length at the configured maxLength', async () => {
      const adapter = makeScriptedAdapter([
        'Reply.',
        '关于多租户数据库架构设计的深度技术讨论与实施方案细节',
      ]);
      const conversationService = new InMemoryConversationService();
      const service = new AIService({ adapter, conversationService, logger: silentLogger });
      service.setTitleGenerationConfig({ enabled: true, maxLength: 12 });

      const conv = await conversationService.create();
      await service.chatWithTools(
        [{ role: 'user', content: '帮我设计数据库' } as ModelMessage],
        { toolExecutionContext: { conversationId: conv.id } } as any,
      );
      await flushMicrotasks();

      const after = await conversationService.get(conv.id);
      expect(after?.title).toBeDefined();
      expect((after!.title as string).length).toBeLessThanOrEqual(12);
      expect(after!.title!.startsWith('关于多租户')).toBe(true);
    });

    it('is idempotent — second turn on the same conversation does not re-summarize', async () => {
      const chatSpy = vi.fn(async (_messages: any) => ({
        content: 'Assistant reply.',
        toolCalls: undefined,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        model: 'spy',
      }));
      // First two reply slots, third+ should not be reached for a title twice.
      const adapter = { name: 'spy', chat: chatSpy } as unknown as LLMAdapter;
      const conversationService = new InMemoryConversationService();
      const service = new AIService({ adapter, conversationService, logger: silentLogger });
      service.setTitleGenerationConfig({ enabled: true, maxLength: 24 });

      const conv = await conversationService.create();
      // Turn 1
      await service.chatWithTools(
        [{ role: 'user', content: 'first question' } as ModelMessage],
        { toolExecutionContext: { conversationId: conv.id } } as any,
      );
      await flushMicrotasks();
      const callsAfterFirst = chatSpy.mock.calls.length;

      // Turn 2 — assistant reply call happens, but no additional title call.
      await service.chatWithTools(
        [{ role: 'user', content: 'follow-up question' } as ModelMessage],
        { toolExecutionContext: { conversationId: conv.id } } as any,
      );
      await flushMicrotasks();
      const callsAfterSecond = chatSpy.mock.calls.length;

      // First turn: 1 reply + 1 title = 2 calls.
      // Second turn: 1 reply only = 1 extra call (no second title).
      expect(callsAfterFirst).toBe(2);
      expect(callsAfterSecond - callsAfterFirst).toBe(1);
    });

    it('swallows adapter failures during titling without breaking chat', async () => {
      let i = 0;
      const adapter = {
        name: 'flaky',
        async chat() {
          i++;
          if (i === 1) {
            return {
              content: 'Primary reply OK',
              toolCalls: undefined,
              usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
              model: 'flaky',
            };
          }
          throw new Error('rate limited');
        },
      } as unknown as LLMAdapter;
      const conversationService = new InMemoryConversationService();
      const service = new AIService({ adapter, conversationService, logger: silentLogger });
      service.setTitleGenerationConfig({ enabled: true, maxLength: 24 });

      const conv = await conversationService.create();
      const result = await service.chatWithTools(
        [{ role: 'user', content: 'will this error' } as ModelMessage],
        { toolExecutionContext: { conversationId: conv.id } } as any,
      );
      await flushMicrotasks();

      // Chat should succeed even though the title call threw.
      expect(result.content).toBe('Primary reply OK');
      const after = await conversationService.get(conv.id);
      expect(after?.title ?? undefined).toBeUndefined();
    });
  });
});

import { describe, it, expect } from 'vitest';
import type {
  IAIService,
  AIResult,
  AIToolDefinition,
  AIRequestOptions,
  AIConversation,
  IAIConversationService,
  PendingActionStatus,
} from './ai-service';
import type {
  ModelMessage,
  ToolCallPart,
  ToolResultPart,
  TextStreamPart,
  ToolSet,
} from 'ai';

describe('AI Service Contract', () => {
  it('should allow a minimal IAIService implementation with required methods', () => {
    const service: IAIService = {
      chat: async (_messages, _options?) => ({ content: '' }),
      complete: async (_prompt, _options?) => ({ content: '' }),
    };

    expect(typeof service.chat).toBe('function');
    expect(typeof service.complete).toBe('function');
  });

  it('should allow a full implementation with optional methods', () => {
    const service: IAIService = {
      chat: async () => ({ content: '' }),
      complete: async () => ({ content: '' }),
      embed: async () => [[]],
      listModels: async () => [],
    };

    expect(service.embed).toBeDefined();
    expect(service.listModels).toBeDefined();
  });

  it('should generate a chat completion with ModelMessage', async () => {
    const service: IAIService = {
      chat: async (messages): Promise<AIResult> => {
        const lastMessage = messages[messages.length - 1];
        const text = typeof lastMessage.content === 'string'
          ? lastMessage.content
          : 'complex content';
        return {
          content: `Echo: ${text}`,
          model: 'test-model',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        };
      },
      complete: async () => ({ content: '' }),
    };

    const messages: ModelMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
    ];

    const result = await service.chat(messages);
    expect(result.content).toBe('Echo: Hello');
    expect(result.model).toBe('test-model');
    expect(result.usage?.totalTokens).toBe(15);
  });

  it('should generate a text completion', async () => {
    const service: IAIService = {
      chat: async () => ({ content: '' }),
      complete: async (prompt, options?): Promise<AIResult> => ({
        content: `Completed: ${prompt}`,
        model: options?.model ?? 'default',
      }),
    };

    const result = await service.complete('The sky is', { model: 'gpt-4', maxTokens: 50 });
    expect(result.content).toContain('The sky is');
    expect(result.model).toBe('gpt-4');
  });

  it('should generate embeddings', async () => {
    const service: IAIService = {
      chat: async () => ({ content: '' }),
      complete: async () => ({ content: '' }),
      embed: async (input) => {
        const texts = Array.isArray(input) ? input : [input];
        return texts.map(() => [0.1, 0.2, 0.3]);
      },
    };

    const embeddings = await service.embed!('Hello world');
    expect(embeddings).toHaveLength(1);
    expect(embeddings[0]).toEqual([0.1, 0.2, 0.3]);

    const batch = await service.embed!(['Hello', 'World']);
    expect(batch).toHaveLength(2);
  });

  it('should list available models', async () => {
    const service: IAIService = {
      chat: async () => ({ content: '' }),
      complete: async () => ({ content: '' }),
      listModels: async () => ['gpt-4', 'gpt-3.5-turbo', 'claude-3-sonnet'],
    };

    const models = await service.listModels!();
    expect(models).toHaveLength(3);
    expect(models).toContain('gpt-4');
  });

  // -----------------------------------------------------------------------
  // Vercel AI SDK Type Integration
  // -----------------------------------------------------------------------

  describe('Vercel AI SDK Type Integration', () => {
    it('should accept Vercel ModelMessage types', () => {
      const systemMsg: ModelMessage = {
        role: 'system',
        content: 'You are helpful.',
      };
      expect(systemMsg.role).toBe('system');

      const userMsg: ModelMessage = {
        role: 'user',
        content: 'Hello',
      };
      expect(userMsg.role).toBe('user');

      const assistantMsg: ModelMessage = {
        role: 'assistant',
        content: 'Hi there!',
      };
      expect(assistantMsg.role).toBe('assistant');
    });

    it('should accept assistant messages with tool call parts', () => {
      const toolCallPart: ToolCallPart = {
        type: 'tool-call',
        toolCallId: 'call_1',
        toolName: 'get_weather',
        input: { location: 'Paris' },
      };

      expect(toolCallPart.type).toBe('tool-call');
      expect(toolCallPart.toolCallId).toBe('call_1');
      expect(toolCallPart.toolName).toBe('get_weather');

      const assistantMsg: ModelMessage = {
        role: 'assistant',
        content: [toolCallPart],
      };

      expect(assistantMsg.role).toBe('assistant');
    });

    it('should accept tool result parts', () => {
      const toolResult: ToolResultPart = {
        type: 'tool-result',
        toolCallId: 'call_1',
        toolName: 'get_weather',
        output: { type: 'text', value: '{"temp": 22}' },
      };

      expect(toolResult.type).toBe('tool-result');
      expect(toolResult.toolCallId).toBe('call_1');
    });

    it('should construct valid AIToolDefinition values', () => {
      const tool: AIToolDefinition = {
        name: 'get_weather',
        description: 'Get current weather for a location',
        parameters: {
          type: 'object',
          properties: { location: { type: 'string' } },
          required: ['location'],
        },
      };

      expect(tool.name).toBe('get_weather');
      expect(tool.description).toBe('Get current weather for a location');
      expect(tool.parameters).toBeDefined();
    });

    it('should support tool options on AIRequestOptions', () => {
      const options: AIRequestOptions = {
        model: 'gpt-4',
        temperature: 0.7,
        tools: [
          {
            name: 'search',
            description: 'Search the web',
            parameters: { type: 'object', properties: {} },
          },
        ],
        toolChoice: 'auto',
      };

      expect(options.tools).toHaveLength(1);
      expect(options.toolChoice).toBe('auto');
    });

    it('should support non-streaming tool calling via chat()', async () => {
      const service: IAIService = {
        chat: async (_messages, options?) => {
          if (options?.tools && options.tools.length > 0) {
            return { content: 'Using tools', model: 'gpt-4' };
          }
          return { content: 'No tools' };
        },
        complete: async () => ({ content: '' }),
      };

      const result = await service.chat(
        [{ role: 'user', content: 'What is the weather?' }],
        {
          model: 'gpt-4',
          tools: [{ name: 'get_weather', description: 'Get weather', parameters: {} }],
          toolChoice: 'auto',
        },
      );

      expect(result.content).toBe('Using tools');
    });
  });

  // -----------------------------------------------------------------------
  // Streaming – streamChat (Vercel TextStreamPart)
  // -----------------------------------------------------------------------

  describe('streamChat', () => {
    it('should allow IAIService implementation with streamChat', () => {
      const service: IAIService = {
        chat: async () => ({ content: '' }),
        complete: async () => ({ content: '' }),
        async *streamChat() {
          yield { type: 'text-delta' as const, id: '1', text: 'Hello' } as TextStreamPart<ToolSet>;
          yield { type: 'finish' as const, finishReason: 'stop' as const, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, request: {}, response: { id: '', timestamp: new Date(), modelId: '', headers: {} }, providerMetadata: undefined, warnings: undefined, reasoning: undefined, files: undefined, sources: undefined, isContinued: false } as unknown as TextStreamPart<ToolSet>;
        },
      };

      expect(service.streamChat).toBeDefined();
    });

    it('should stream text-delta events (Vercel format)', async () => {
      const service: IAIService = {
        chat: async () => ({ content: '' }),
        complete: async () => ({ content: '' }),
        async *streamChat() {
          yield { type: 'text-delta', id: '1', text: 'Hello' } as TextStreamPart<ToolSet>;
          yield { type: 'text-delta', id: '1', text: ' world' } as TextStreamPart<ToolSet>;
        },
      };

      const events: TextStreamPart<ToolSet>[] = [];
      for await (const event of service.streamChat!([], {})) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('text-delta');
    });

    it('should stream error events', async () => {
      const service: IAIService = {
        chat: async () => ({ content: '' }),
        complete: async () => ({ content: '' }),
        async *streamChat() {
          yield { type: 'error', error: 'Rate limit exceeded' } as TextStreamPart<ToolSet>;
        },
      };

      const events: TextStreamPart<ToolSet>[] = [];
      for await (const event of service.streamChat!([], {})) {
        events.push(event);
      }

      expect(events[0].type).toBe('error');
    });
  });

  // -----------------------------------------------------------------------
  // IAIConversationService
  // -----------------------------------------------------------------------

  describe('IAIConversationService', () => {
    function createMockConversationService(): IAIConversationService {
      const store = new Map<string, AIConversation>();

      return {
        async create(options = {}) {
          const now = new Date().toISOString();
          const conv: AIConversation = {
            id: `conv_${store.size + 1}`,
            title: options.title,
            agentId: options.agentId,
            userId: options.userId,
            messages: [],
            createdAt: now,
            updatedAt: now,
            metadata: options.metadata,
          };
          store.set(conv.id, conv);
          return conv;
        },

        async get(conversationId) {
          return store.get(conversationId) ?? null;
        },

        async list(options = {}) {
          let results = Array.from(store.values());
          if (options.userId) {
            results = results.filter((c) => c.userId === options.userId);
          }
          if (options.agentId) {
            results = results.filter((c) => c.agentId === options.agentId);
          }
          if (options.limit) {
            results = results.slice(0, options.limit);
          }
          return results;
        },

        async addMessage(conversationId, message) {
          const conv = store.get(conversationId);
          if (!conv) throw new Error('Conversation not found');
          conv.messages.push(message);
          conv.updatedAt = new Date().toISOString();
          return conv;
        },

        async delete(conversationId) {
          store.delete(conversationId);
        },
      };
    }

    it('should create a conversation', async () => {
      const svc = createMockConversationService();
      const conv = await svc.create({ title: 'Test Chat', userId: 'user_1' });

      expect(conv.id).toBeDefined();
      expect(conv.title).toBe('Test Chat');
      expect(conv.userId).toBe('user_1');
      expect(conv.messages).toHaveLength(0);
      expect(conv.createdAt).toBeDefined();
    });

    it('should get a conversation by ID', async () => {
      const svc = createMockConversationService();
      const created = await svc.create({ title: 'Lookup Test' });

      const found = await svc.get(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);

      const missing = await svc.get('nonexistent');
      expect(missing).toBeNull();
    });

    it('should list conversations with filters', async () => {
      const svc = createMockConversationService();
      await svc.create({ userId: 'user_a', agentId: 'agent_1' });
      await svc.create({ userId: 'user_b', agentId: 'agent_1' });
      await svc.create({ userId: 'user_a', agentId: 'agent_2' });

      const all = await svc.list();
      expect(all).toHaveLength(3);

      const byUser = await svc.list({ userId: 'user_a' });
      expect(byUser).toHaveLength(2);

      const byAgent = await svc.list({ agentId: 'agent_1' });
      expect(byAgent).toHaveLength(2);

      const limited = await svc.list({ limit: 1 });
      expect(limited).toHaveLength(1);
    });

    it('should add Vercel ModelMessage to a conversation', async () => {
      const svc = createMockConversationService();
      const conv = await svc.create({ title: 'Message Test' });

      const updated = await svc.addMessage(conv.id, {
        role: 'user',
        content: 'Hello!',
      });

      expect(updated.messages).toHaveLength(1);

      const updated2 = await svc.addMessage(conv.id, {
        role: 'assistant',
        content: 'Hi there!',
      });

      expect(updated2.messages).toHaveLength(2);
    });

    it('should delete a conversation', async () => {
      const svc = createMockConversationService();
      const conv = await svc.create({ title: 'Delete Me' });

      await svc.delete(conv.id);
      const result = await svc.get(conv.id);
      expect(result).toBeNull();
    });

    it('should support metadata on conversations', async () => {
      const svc = createMockConversationService();
      const conv = await svc.create({
        title: 'With Meta',
        metadata: { source: 'web', tags: ['support'] },
      });

      expect(conv.metadata).toEqual({ source: 'web', tags: ['support'] });
    });
  });
});

/** Type-level identity: true iff A and B are the same type. */
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
/** Compile error when the argument is not `true`. */
type Assert<T extends true> = T;

type ApproveOutcomeStatus = Awaited<ReturnType<NonNullable<IAIService['approvePendingAction']>>>['status'];

// Exported deliberately: an unread alias is TS6196, and a pin no program compiles is no pin.

/** `held` is a lifecycle status, and the approve outcome may be `held`. */
export type PendingActionStatusHasHeld = Assert<Eq<Extract<PendingActionStatus, 'held'>, 'held'>>;
export type ApproveOutcomeIsExecutedHeldOrFailed = Assert<Eq<ApproveOutcomeStatus, 'executed' | 'held' | 'failed'>>;

describe('approvePendingAction held outcome', () => {
  it('lets an implementation answer held, with the hold as its result', async () => {
    const service: IAIService = {
      chat: async () => ({ content: '' }),
      complete: async () => ({ content: '' }),
      approvePendingAction: async () => ({ status: 'held', result: { code: 'AI_WRITE_HELD' } }),
    };
    const outcome = await service.approvePendingAction!('pa_1', 'user_1');
    expect(outcome.status).toBe('held');
    const status: PendingActionStatus = outcome.status;
    expect(status).toBe('held');
  });
});

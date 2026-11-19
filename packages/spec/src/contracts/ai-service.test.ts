import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/**
 * The in-app assistant door's three points, stated on the pending-action
 * members themselves (#33689 Q1, ruled B: one rule for every AI door, the
 * in-app queue kept as its own channel). The members' signatures do not move,
 * so what is pinned is the docblock text an implementer reads beside them:
 * who decides, which credential, and as whom the approved action runs.
 */
describe('IAIService pending-action members state the in-app door\'s three points', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const SOURCE = readFileSync(join(HERE, 'ai-service.ts'), 'utf8');

  /** The docblock above `    <member>?(`, comment gutters folded into spaces. */
  function memberDoc(member: string): string {
    const at = SOURCE.indexOf(`    ${member}?(`);
    expect(at, `\`${member}\` moved — re-anchor this pin`).toBeGreaterThan(-1);
    const open = SOURCE.lastIndexOf('/**', at);
    const close = SOURCE.indexOf('*/', open);
    expect(close, `\`${member}\` has no docblock directly above it`).toBeLessThan(at);
    return SOURCE.slice(open, close).replace(/\n\s*\*\s?/g, ' ').replace(/\s+/g, ' ');
  }

  it('proposePendingAction names the channel and binds all three points from the moment it is recorded', () => {
    const doc = memberDoc('proposePendingAction');
    expect(doc).toMatch(/in-app assistant door's channel of the confirmation rule/);
    expect(doc).toMatch(/\*\*Who decides:\*\* only the person the call ran as, recorded as `proposedBy`; no other user decides it, whatever permission they hold, `ai:approve` included/);
    expect(doc).toMatch(/\*\*Which credential:\*\* the item is decided on that person's signed-in session to the app, never on an API key, token or AI identity/);
    expect(doc).toMatch(/\*\*As whom it runs:\*\* once approved, as that person, every gate and permission re-checked/);
    // A declared-gated action is queued, not only the destructive heuristic.
    expect(doc).toMatch(/declares `ai\.requiresConfirmation: true`/);
  });

  it('approvePendingAction refuses another user and a non-session credential, and runs as the person', () => {
    const doc = memberDoc('approvePendingAction');
    expect(doc).toMatch(/`actorId` must be the person the call ran as \(the row's `proposed_by`\)\. Another user is refused whatever permission they hold, `ai:approve` included/);
    expect(doc).toMatch(/admits only a person's signed-in session to the app; an API key, a delegated or OAuth token, any other service credential and an AI identity are refused/);
    expect(doc).toMatch(/the re-dispatch runs as that person, through the same admitted sequence as any action call, every gate and permission re-checked at this moment/);
    // The second-person path is `held`, never a second decider.
    expect(doc).toMatch(/second person to approve the write does not let that person decide the item: it uses `held`/);
    // Control: the held outcome text this pin sits beside is still there, so
    // the anchor read the right docblock.
    expect(doc).toMatch(/`held` is the third outcome/);
  });

  it('rejectPendingAction binds the deciding points and runs nothing', () => {
    const doc = memberDoc('rejectPendingAction');
    expect(doc).toMatch(/Nothing runs\./);
    expect(doc).toMatch(/`actorId` must be the person the call ran as \(the row's `proposed_by`\), whatever permission another user holds, `ai:approve` included/);
    expect(doc).toMatch(/admits only that person's signed-in session to the app, never an API key, token or AI identity/);
  });

  it('the read member is not a deciding door: listPendingActions carries none of the three points', () => {
    // Control leg: the helper does not answer every member with the same
    // text. Listing is not deciding, and the ruling moved no read.
    const doc = memberDoc('listPendingActions');
    expect(doc).toMatch(/Inbox query/);
    expect(doc).not.toMatch(/Who decides/);
    expect(doc).not.toMatch(/signed-in session/);
  });
});

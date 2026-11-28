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
  IActionConfirmationService,
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

type ApproveOutcomeStatus = Awaited<ReturnType<IActionConfirmationService['approve']>>['status'];

// Exported deliberately: an unread alias is TS6196, and a pin no program compiles is no pin.

/** `held` is a lifecycle status, and the approve outcome may be `held`. */
export type PendingActionStatusHasHeld = Assert<Eq<Extract<PendingActionStatus, 'held'>, 'held'>>;
export type ApproveOutcomeIsExecutedHeldOrFailed = Assert<Eq<ApproveOutcomeStatus, 'executed' | 'held' | 'failed'>>;

/** The in-app queue left `IAIService`: none of its four members is declared there any more. */
export type IAIServiceHasNoPendingActionMember = Assert<
  Eq<Extract<keyof IAIService, 'proposePendingAction' | 'approvePendingAction' | 'rejectPendingAction' | 'listPendingActions'>, never>
>;
/** The pending-confirmation service carries the whole lifecycle, every member required. */
export type ConfirmationServiceLifecycle = Assert<
  Eq<keyof IActionConfirmationService, 'submit' | 'list' | 'get' | 'approve' | 'reject'>
>;

/** A full pending-confirmation service, the in-app door's items included. */
function confirmationService(overrides: Partial<IActionConfirmationService> = {}): IActionConfirmationService {
  return {
    submit: async () => ({ pendingId: 'pc_1' }),
    list: async () => [],
    get: async () => null,
    approve: async () => ({ status: 'executed' }),
    reject: async () => undefined,
    ...overrides,
  };
}

describe('IActionConfirmationService approve held outcome', () => {
  it('lets an implementation answer held, with the hold as its result', async () => {
    const service = confirmationService({
      approve: async () => ({ status: 'held', result: { code: 'AI_WRITE_HELD' } }),
    });
    const outcome = await service.approve('pc_1', { userId: 'user_1' });
    expect(outcome.status).toBe('held');
    const status: PendingActionStatus = outcome.status;
    expect(status).toBe('held');
  });

  it('records an in-app item through submit, with the tool call and the conversation it was made in', async () => {
    const recorded: unknown[] = [];
    const service = confirmationService({
      submit: async (handOff) => {
        recorded.push(handOff);
        return { pendingId: 'pc_inapp' };
      },
    });
    await expect(service.submit({
      actionName: 'delete_account', objectName: 'account', recordId: 'a1', params: { id: 'a1' },
      door: 'assistant', toolName: 'action_account_delete_account', conversationId: 'conv_1', messageId: 'msg_1',
    }, { userId: 'user_1' })).resolves.toEqual({ pendingId: 'pc_inapp' });
    expect(recorded).toHaveLength(1);
    // Control: the MCP hand-off shape, with no in-app field, is still a hand-off.
    await expect(service.submit({ actionName: 'archive_account', params: {}, door: 'mcp' }, { userId: 'user_1' }))
      .resolves.toEqual({ pendingId: 'pc_inapp' });
  });

  it('refuses a submit-only service: the lifecycle members are not optional', () => {
    // @ts-expect-error — a delivery-only service no longer satisfies the contract.
    const deliveryOnly: IActionConfirmationService = { submit: async () => ({ pendingId: 'pc_1' }) };
    expect(typeof deliveryOnly.submit).toBe('function');
  });
});

/**
 * The deciding points, stated on the pending-confirmation service's members
 * themselves (#33689 Q1 ruled one rule for every AI door; #33806 ruled the
 * in-app queue merged into this service). What is pinned is the docblock text
 * an implementer reads beside them: who decides, which credential, and as
 * whom the approved call runs.
 */
describe('IActionConfirmationService members state the deciding points', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const SOURCE = readFileSync(join(HERE, 'ai-service.ts'), 'utf8');
  const SERVICE = SOURCE.slice(SOURCE.indexOf('export interface IActionConfirmationService {'));

  /** The docblock above `    <member>(` inside the service, comment gutters folded into spaces. */
  function memberDoc(member: string): string {
    const at = SERVICE.indexOf(`    ${member}(`);
    expect(at, `\`${member}\` moved — re-anchor this pin`).toBeGreaterThan(-1);
    const open = SERVICE.lastIndexOf('/**', at);
    const close = SERVICE.indexOf('*/', open);
    expect(close, `\`${member}\` has no docblock directly above it`).toBeLessThan(at);
    return SERVICE.slice(open, close).replace(/\n\s*\*\s?/g, ' ').replace(/\s+/g, ' ');
  }

  it('approve refuses another user and a non-session credential, and runs as the person', () => {
    const doc = memberDoc('approve');
    expect(doc).toMatch(/`context` must be the person the call ran as \(the row's `proposed_by`\)\. Another user is refused whatever permission they hold, `ai:approve` included/);
    expect(doc).toMatch(/admits only a person's signed-in session to the app; an API key, a delegated or OAuth token, any other service credential and an AI identity are refused/);
    expect(doc).toMatch(/the call runs as that person, through the same admitted sequence as any action call, every gate and permission re-checked at this moment/);
    // The second-person path is `held`, never a second decider.
    expect(doc).toMatch(/second person to approve the write does not let that person decide the item: it uses `held`/);
    // Control: the held outcome text this pin sits beside is still there, so
    // the anchor read the right docblock.
    expect(doc).toMatch(/`held` is the third outcome/);
  });

  it('reject binds the deciding points and runs nothing', () => {
    const doc = memberDoc('reject');
    expect(doc).toMatch(/Nothing runs\./);
    expect(doc).toMatch(/`context` must be the person the call ran as \(the row's `proposed_by`\), whatever permission another user holds, `ai:approve` included/);
    expect(doc).toMatch(/admits only that person's signed-in session to the app, never an API key, token or AI identity/);
  });

  it('the read members are not deciding doors: list and get carry none of the points', () => {
    // Control leg: the helper does not answer every member with the same
    // text. Listing and reading are not deciding.
    for (const member of ['list', 'get']) {
      const doc = memberDoc(member);
      expect(doc).toMatch(/Reading is not deciding/);
      expect(doc).not.toMatch(/Who decides/);
      expect(doc).not.toMatch(/signed-in session/);
    }
  });

  it('IAIService no longer declares the pending-action queue', () => {
    const iai = SOURCE.slice(SOURCE.indexOf('export interface IAIService {'), SOURCE.indexOf('export type PendingActionStatus'));
    expect(iai.length, 'IAIService not found').toBeGreaterThan(1000);
    for (const member of ['proposePendingAction', 'approvePendingAction', 'rejectPendingAction', 'listPendingActions']) {
      expect(iai, `IAIService declares \`${member}\` again`).not.toContain(`    ${member}?(`);
    }
    // Control: the slice holds IAIService's members, so an absence above is real.
    expect(iai).toContain('    chatWithTools?(');
  });
});

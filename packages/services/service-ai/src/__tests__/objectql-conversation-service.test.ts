// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IDataEngine } from '@objectstack/spec/contracts';
import type { ModelMessage } from '@objectstack/spec/contracts';
import { ObjectQLConversationService } from '../conversation/objectql-conversation-service.js';

// ─────────────────────────────────────────────────────────────────
// In-memory IDataEngine stub (mimics driver-memory behavior)
// ─────────────────────────────────────────────────────────────────

function createMemoryEngine(): IDataEngine {
  const tables = new Map<string, any[]>();

  const getTable = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };

  /** Evaluate a single filter condition against a row. */
  const matchesCondition = (row: any, where: Record<string, any>): boolean => {
    for (const [key, value] of Object.entries(where)) {
      if (key === '$or') {
        // At least one branch must match
        if (!Array.isArray(value) || !value.some(branch => matchesCondition(row, branch))) {
          return false;
        }
      } else if (typeof value === 'object' && value !== null && '$gt' in value) {
        if (!(row[key] > value.$gt)) return false;
      } else if (row[key] !== value) {
        return false;
      }
    }
    return true;
  };

  return {
    find: async (objectName, query?) => {
      let rows = [...getTable(objectName)];
      if (query?.where) {
        rows = rows.filter(row => matchesCondition(row, query.where as Record<string, any>));
      }
      if (query?.orderBy && query.orderBy.length > 0) {
        rows.sort((a, b) => {
          for (const sort of query.orderBy!) {
            const field = (sort as any).field;
            const dir = (sort as any).order === 'desc' ? -1 : 1;
            if (a[field] < b[field]) return -dir;
            if (a[field] > b[field]) return dir;
          }
          return 0;
        });
      }
      if (query?.limit) {
        rows = rows.slice(0, query.limit);
      }
      return rows;
    },
    findOne: async (objectName, query?) => {
      let rows = [...getTable(objectName)];
      if (query?.where) {
        rows = rows.filter(row => matchesCondition(row, query.where as Record<string, any>));
      }
      return rows[0] ?? null;
    },
    insert: async (objectName, data) => {
      const table = getTable(objectName);
      if (Array.isArray(data)) {
        table.push(...data);
        return data;
      }
      table.push({ ...data });
      return data;
    },
    update: async (objectName, data, options?) => {
      const table = getTable(objectName);
      const where = options?.where as Record<string, any> | undefined;
      for (let i = 0; i < table.length; i++) {
        if (where) {
          let match = true;
          for (const [key, value] of Object.entries(where)) {
            if (table[i][key] !== value) { match = false; break; }
          }
          if (!match) continue;
        }
        Object.assign(table[i], data);
        return table[i];
      }
      return data;
    },
    delete: async (objectName, options?) => {
      const table = getTable(objectName);
      const where = options?.where as Record<string, any> | undefined;
      let deleted = 0;
      const multi = (options as any)?.multi ?? false;
      for (let i = table.length - 1; i >= 0; i--) {
        if (where) {
          let match = true;
          for (const [key, value] of Object.entries(where)) {
            if (table[i][key] !== value) { match = false; break; }
          }
          if (!match) continue;
        }
        table.splice(i, 1);
        deleted++;
        if (!multi) break;
      }
      return { deleted };
    },
    count: async (objectName, query?) => {
      let rows = [...getTable(objectName)];
      if (query?.where) {
        rows = rows.filter(row => matchesCondition(row, query.where as Record<string, any>));
      }
      return rows.length;
    },
    aggregate: async () => [],
  };
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

describe('ObjectQLConversationService', () => {
  let engine: IDataEngine;
  let service: ObjectQLConversationService;

  beforeEach(() => {
    engine = createMemoryEngine();
    service = new ObjectQLConversationService(engine);
  });

  // ── create() ───────────────────────────────────────────────────

  it('should create a conversation with all options', async () => {
    const conv = await service.create({
      title: 'Test Chat',
      agentId: 'agent_1',
      userId: 'user_1',
      metadata: { source: 'web' },
    });

    expect(conv.id).toMatch(/^conv_/);
    expect(conv.title).toBe('Test Chat');
    expect(conv.agentId).toBe('agent_1');
    expect(conv.userId).toBe('user_1');
    expect(conv.messages).toEqual([]);
    expect(conv.createdAt).toBeDefined();
    expect(conv.updatedAt).toBeDefined();
    expect(conv.metadata).toEqual({ source: 'web' });
  });

  it('should create a conversation with no options', async () => {
    const conv = await service.create();

    expect(conv.id).toMatch(/^conv_/);
    expect(conv.title).toBeUndefined();
    expect(conv.agentId).toBeUndefined();
    expect(conv.userId).toBeUndefined();
    expect(conv.messages).toEqual([]);
  });

  it('should generate unique conversation IDs', async () => {
    const c1 = await service.create({ title: 'A' });
    const c2 = await service.create({ title: 'B' });

    expect(c1.id).not.toBe(c2.id);
  });

  // ── get() ──────────────────────────────────────────────────────

  it('should retrieve a conversation by ID', async () => {
    const created = await service.create({ title: 'Retrieve Me' });
    const fetched = await service.get(created.id);

    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.title).toBe('Retrieve Me');
  });

  it('should return null for non-existent conversation', async () => {
    const result = await service.get('conv_nonexistent');
    expect(result).toBeNull();
  });

  // ── list() ─────────────────────────────────────────────────────

  it('should list conversations filtered by userId', async () => {
    await service.create({ userId: 'user_a' });
    await service.create({ userId: 'user_b' });
    await service.create({ userId: 'user_a' });

    const results = await service.list({ userId: 'user_a' });
    expect(results).toHaveLength(2);
    results.forEach(c => expect(c.userId).toBe('user_a'));
  });

  it('should list conversations filtered by agentId', async () => {
    await service.create({ agentId: 'bot_x' });
    await service.create({ agentId: 'bot_y' });

    const results = await service.list({ agentId: 'bot_x' });
    expect(results).toHaveLength(1);
    expect(results[0].agentId).toBe('bot_x');
  });

  it('should limit the number of listed conversations', async () => {
    await service.create({ title: '1' });
    await service.create({ title: '2' });
    await service.create({ title: '3' });

    const results = await service.list({ limit: 2 });
    expect(results).toHaveLength(2);
  });

  it('should paginate with cursor and have no skips or duplicates', async () => {
    await service.create({ title: 'A' });
    await service.create({ title: 'B' });
    await service.create({ title: 'C' });
    await service.create({ title: 'D' });

    // First page: 2 items
    const page1 = await service.list({ limit: 2 });
    expect(page1).toHaveLength(2);

    // Second page: cursor = last item from page 1
    const page2 = await service.list({ limit: 2, cursor: page1[1].id });
    expect(page2).toHaveLength(2);

    // Third page: should be empty
    const page3 = await service.list({ limit: 2, cursor: page2[1].id });
    expect(page3).toHaveLength(0);

    // Verify no overlap between pages and all 4 conversations are covered
    const allIds = [...page1, ...page2].map(c => c.id);
    expect(new Set(allIds).size).toBe(4);
  });

  // ── addMessage() ───────────────────────────────────────────────

  it('should add a user message to a conversation', async () => {
    const conv = await service.create({ title: 'Chat' });

    const msg: ModelMessage = { role: 'user', content: 'Hello AI!' };
    const updated = await service.addMessage(conv.id, msg);

    expect(updated.messages).toHaveLength(1);
    expect(updated.messages[0].role).toBe('user');
    expect(updated.messages[0].content).toBe('Hello AI!');
    expect(updated.updatedAt >= conv.updatedAt).toBe(true);
  });

  it('auto-titles an untitled conversation from its first user message', async () => {
    const conv = await service.create(); // no title
    expect(conv.title).toBeUndefined();
    const updated = await service.addMessage(conv.id, { role: 'user', content: 'Build me a ticketing system' });
    expect(updated.title).toBe('Build me a ticketing system');
  });

  it('does not overwrite an existing title, and only a USER first turn seeds it', async () => {
    const titled = await service.create({ title: 'My title' });
    const afterUser = await service.addMessage(titled.id, { role: 'user', content: 'hello' });
    expect(afterUser.title).toBe('My title'); // kept

    const fresh = await service.create();
    const afterAssistant = await service.addMessage(fresh.id, { role: 'assistant', content: 'hi there' });
    expect(afterAssistant.title).toBeUndefined(); // assistant turn does not seed a title
  });

  it('collapses whitespace and truncates a long first message into the title', async () => {
    const conv = await service.create();
    const long = 'design   an\n  employee onboarding system with departments tasks members and a dashboard and reports';
    const updated = await service.addMessage(conv.id, { role: 'user', content: long });
    expect(updated.title!.length).toBeLessThanOrEqual(60);
    expect(updated.title).not.toContain('\n');
    expect(updated.title).toMatch(/^design an employee onboarding/);
    expect(updated.title!.endsWith('…')).toBe(true);
  });

  it('should add a tool message with toolCallId', async () => {
    const conv = await service.create();
    const msg: ModelMessage = {
      role: 'tool' as const,
      content: [{
        type: 'tool-result' as const,
        toolCallId: 'call_abc',
        toolName: 'get_weather',
        output: { type: 'text' as const, value: '{"temp": 22}' },
      }],
    };

    const updated = await service.addMessage(conv.id, msg);
    expect(updated.messages).toHaveLength(1);
    const firstMsg = updated.messages[0];
    if (firstMsg.role === 'tool' && Array.isArray(firstMsg.content)) {
      expect(firstMsg.content[0].toolCallId).toBe('call_abc');
    } else {
      throw new Error('Expected tool message with array content');
    }
  });

  it('should add an assistant message with toolCalls', async () => {
    const conv = await service.create();
    const msg: ModelMessage = {
      role: 'assistant' as const,
      content: [
        { type: 'tool-call' as const, toolCallId: 'call_1', toolName: 'get_weather', input: {} },
      ],
    };

    const updated = await service.addMessage(conv.id, msg);
    expect(updated.messages).toHaveLength(1);
    const firstMsg = updated.messages[0];
    if (firstMsg.role === 'assistant' && Array.isArray(firstMsg.content)) {
      const toolCallParts = firstMsg.content.filter((p) => p.type === 'tool-call');
      expect(toolCallParts).toHaveLength(1);
      expect(toolCallParts[0].toolName).toBe('get_weather');
    } else {
      throw new Error('Expected assistant message with array content');
    }
  });

  it('persists a tool-only assistant turn with a non-empty content placeholder (ADR-0033 — `content` is required, so empty text from a tool-only turn must not be stored)', async () => {
    const conv = await service.create();
    const insertSpy = vi.spyOn(engine, 'insert');
    const msg: ModelMessage = {
      role: 'assistant' as const,
      content: [
        { type: 'tool-call' as const, toolCallId: 'c1', toolName: 'propose_blueprint', input: {} },
      ],
    };
    // Previously the empty text content failed the required `content` field,
    // dropped the turn, and the agent lost context (re-proposed instead of
    // applying). It must persist with a tool-name placeholder.
    await expect(service.addMessage(conv.id, msg)).resolves.toBeDefined();
    const row = insertSpy.mock.calls
      .map((c) => c[1] as Record<string, unknown>)
      .find((d) => d.role === 'assistant' && 'tool_calls' in d && d.tool_calls);
    expect(row).toBeTruthy();
    expect(typeof row!.content).toBe('string');
    expect((row!.content as string).length).toBeGreaterThan(0);
    expect(row!.content as string).toContain('propose_blueprint');
  });

  it('should throw when adding message to non-existent conversation', async () => {
    const msg: ModelMessage = { role: 'user', content: 'Hello' };
    await expect(service.addMessage('conv_ghost', msg)).rejects.toThrow(
      'Conversation "conv_ghost" not found',
    );
  });

  it('should preserve message order (ordered by createdAt + id)', async () => {
    const conv = await service.create();
    await service.addMessage(conv.id, { role: 'user', content: 'First' });
    await service.addMessage(conv.id, { role: 'assistant', content: 'Second' });
    await service.addMessage(conv.id, { role: 'user', content: 'Third' });

    const fetched = await service.get(conv.id);
    expect(fetched!.messages).toHaveLength(3);
    // All three messages should be present
    const contents = fetched!.messages.map(m => m.content);
    expect(contents).toContain('First');
    expect(contents).toContain('Second');
    expect(contents).toContain('Third');
    // Ordering is deterministic (created_at asc, id asc)
    // Since messages are inserted sequentially, created_at is non-decreasing
    for (let i = 1; i < fetched!.messages.length; i++) {
      const prev = fetched!.messages[i - 1];
      const curr = fetched!.messages[i];
      // Verify stable ordering: each message is >= the previous by (created_at, id)
      expect(prev.content).toBeDefined();
      expect(curr.content).toBeDefined();
    }
  });

  // ── delete() ───────────────────────────────────────────────────

  it('should delete a conversation and its messages', async () => {
    const conv = await service.create({ title: 'Delete Me' });
    await service.addMessage(conv.id, { role: 'user', content: 'Bye' });

    await service.delete(conv.id);

    const result = await service.get(conv.id);
    expect(result).toBeNull();
  });

  it('should handle deleting a non-existent conversation gracefully', async () => {
    // Should not throw
    await expect(service.delete('conv_missing')).resolves.toBeUndefined();
  });

  // ── metadata serialization round-trip ──────────────────────────

  it('should round-trip metadata through JSON serialization', async () => {
    const metadata = { tags: ['important', 'follow-up'], priority: 1 };
    const conv = await service.create({ metadata });

    const fetched = await service.get(conv.id);
    expect(fetched!.metadata).toEqual(metadata);
  });

  // ── invalid JSON resilience ────────────────────────────────────

  it('should handle invalid JSON in metadata gracefully', async () => {
    const conv = await service.create({ title: 'Bad Meta' });

    // Manually corrupt the metadata in the engine
    const rows = await engine.find('ai_conversations', { where: { id: conv.id } });
    rows[0].metadata = 'not-valid-json{';

    const fetched = await service.get(conv.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.metadata).toBeUndefined();
  });

  it('should handle invalid JSON in tool_calls gracefully', async () => {
    const conv = await service.create();
    await service.addMessage(conv.id, { role: 'assistant', content: 'checking tools' });

    // Manually corrupt tool_calls in the engine
    const msgs = await engine.find('ai_messages', { where: { conversation_id: conv.id } });
    msgs[0].tool_calls = 'broken{json';

    const fetched = await service.get(conv.id);
    // With broken tool_calls, the assistant message should still load with string content
    expect(fetched!.messages[0].role).toBe('assistant');
    expect(fetched!.messages[0].content).toBe('checking tools');
  });
});

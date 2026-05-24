// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import type {
  ModelMessage,
  AIRequestOptions,
  AIResult,
  AIObjectResult,
  GenerateObjectOptions,
  TextStreamPart,
  ToolSet,
} from '@objectstack/spec/contracts';
import type { LLMAdapter } from '@objectstack/spec/contracts';

/**
 * MemoryLLMAdapter — deterministic in-memory adapter for testing & development.
 *
 * Always echoes back the last user message prefixed with "[memory] ".
 * Useful for unit tests, CI pipelines, and local dev without an LLM key.
 */
export class MemoryLLMAdapter implements LLMAdapter {
  readonly name = 'memory';

  async chat(messages: ModelMessage[], options?: AIRequestOptions): Promise<AIResult> {
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    const userContent = lastUserMessage?.content;
    const text = typeof userContent === 'string' ? userContent : '(complex content)';
    const content = lastUserMessage
      ? `[memory] ${text}`
      : '[memory] (no user message)';

    return {
      content,
      model: options?.model ?? 'memory',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  async complete(prompt: string, options?: AIRequestOptions): Promise<AIResult> {
    return {
      content: `[memory] ${prompt}`,
      model: options?.model ?? 'memory',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  async *streamChat(
    messages: ModelMessage[],
    _options?: AIRequestOptions,
  ): AsyncIterable<TextStreamPart<ToolSet>> {
    const result = await this.chat(messages);
    // Emit word-by-word deltas for realistic streaming simulation
    const words = result.content.split(' ');
    for (let i = 0; i < words.length; i++) {
      const wordText = i === 0 ? words[i] : ` ${words[i]}`;
      yield { type: 'text-delta', id: `delta_${i}`, text: wordText } as TextStreamPart<ToolSet>;
    }
    yield {
      type: 'finish',
      finishReason: 'stop' as const,
      totalUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      rawFinishReason: 'stop',
    } as unknown as TextStreamPart<ToolSet>;
  }

  async embed(input: string | string[]): Promise<number[][]> {
    const texts = Array.isArray(input) ? input : [input];
    // Return deterministic zero vectors of dimension 3
    return texts.map(() => [0, 0, 0]);
  }

  async listModels(): Promise<string[]> {
    return ['memory'];
  }

  /**
   * Heuristic structured-output for testing & demos — NOT a real LLM.
   *
   * Strategy:
   * 1. Extract candidate object names from the system messages by matching
   *    schema-context headers (`### name — Label`) emitted by
   *    {@link SchemaRetriever.renderSnippet}.
   * 2. Pick the candidate whose tokens overlap most with the last user
   *    message (falls back to the first candidate).
   * 3. Try `schema.safeParse({ objectName, limit: 20 })` — this satisfies the
   *    `QueryPlanSchema` used by the built-in `query_data` tool.
   * 4. If that fails, fall back to `schema.safeParse({})` for schemas that
   *    accept defaults.
   * 5. Otherwise throw with a clear message — the demo needs a real provider.
   */
  async generateObject<T = unknown>(
    messages: ModelMessage[],
    schema: z.ZodType<T>,
    options?: GenerateObjectOptions,
  ): Promise<AIObjectResult<T>> {
    const sys = messages
      .filter(m => m.role === 'system')
      .map(m => (typeof m.content === 'string' ? m.content : ''))
      .join('\n');
    const headerRe = /^###\s+([a-z0-9_]+)\b/gim;
    const candidates: string[] = [];
    for (const match of sys.matchAll(headerRe)) {
      if (match[1]) candidates.push(match[1]);
    }

    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const userText = typeof lastUser?.content === 'string'
      ? lastUser.content.toLowerCase()
      : '';
    const userTokens = new Set(
      userText.split(/[^a-z0-9_]+/).filter(t => t.length > 1),
    );

    let chosen = candidates[0];
    let bestScore = -1;
    for (const name of candidates) {
      const score = name
        .split(/[^a-z0-9]+/)
        .reduce((acc, tok) => acc + (tok && userTokens.has(tok) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        chosen = name;
      }
    }

    const attempts: Array<Record<string, unknown>> = [];
    if (chosen) attempts.push({ objectName: chosen, limit: 20 });
    attempts.push({});

    for (const attempt of attempts) {
      const result = schema.safeParse(attempt);
      if (result.success) {
        return {
          object: result.data,
          model: options?.model ?? 'memory',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
      }
    }

    throw new Error(
      'MemoryLLMAdapter.generateObject: unable to synthesise a value for the ' +
      'requested schema. The memory adapter only handles QueryPlan-shaped ' +
      'schemas — wire a real LLM adapter (OpenAI / Anthropic / Google) for ' +
      'arbitrary structured output.',
    );
  }
}

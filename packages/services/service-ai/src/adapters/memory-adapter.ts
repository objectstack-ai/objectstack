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
/**
 * Rough token estimate for the in-memory adapter. The memory adapter stands in
 * for a real LLM in dev/CI/local-E2E; returning a flat `0` usage made every
 * token-metering feature (quota guardrails, usage dashboards, cost caps)
 * impossible to exercise without a paid provider key. This is intentionally
 * crude — ~4 chars/token, the standard ballpark — NOT provider-accurate. It
 * exists so usage-driven behaviour can be tested money-free, not to bill anyone.
 */
function estimateTokens(text: string): number {
  return text ? Math.max(1, Math.ceil(text.length / 4)) : 0;
}

function estimateUsage(messages: ModelMessage[], output = ''): AIResult['usage'] {
  const promptText = messages
    .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n');
  const promptTokens = estimateTokens(promptText);
  const completionTokens = estimateTokens(output);
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

export class MemoryLLMAdapter implements LLMAdapter {
  readonly name = 'memory';

  async chat(messages: ModelMessage[], options?: AIRequestOptions): Promise<AIResult> {
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    const userContent = lastUserMessage?.content;
    const userText = typeof userContent === 'string' ? userContent : '(complex content)';

    // ── Heuristic tool-calling support ──────────────────────────────────────
    // When `chatWithTools` injects available tools the adapter drives a
    // small two-step plan so demos/tests work end-to-end without a real
    // LLM provider:
    //
    //   1. If the user's message looks like an *action* request
    //      (verbs like "complete", "start", "clone", ...) and an
    //      `action_<name>` tool is registered, prefer it. Resolve the
    //      record id from any prior `query_data` result.
    //   2. Otherwise, if a `query_data` tool is present and hasn't been
    //      called yet, call it with the user's text.
    //   3. After a `role: 'tool'` result comes back, summarise it.
    const tools = options?.tools as Array<{ name: string; description?: string }> | undefined;
    const hasQueryDataTool = Array.isArray(tools) && tools.some(t => t?.name === 'query_data');
    const alreadyCalledQueryData = messages.some(
      m =>
        m.role === 'tool' &&
        Array.isArray(m.content) &&
        (m.content as Array<{ toolName?: string }>).some(c => c?.toolName === 'query_data'),
    );
    const alreadyCalledAction = messages.some(
      m =>
        m.role === 'tool' &&
        Array.isArray(m.content) &&
        (m.content as Array<{ toolName?: string }>).some(
          c => typeof c?.toolName === 'string' && c.toolName.startsWith('action_'),
        ),
    );

    // ── Step 1: route action verbs to a matching `action_<name>` tool ──
    if (Array.isArray(tools) && !alreadyCalledAction && lastUserMessage) {
      const actionTools = tools.filter(t => typeof t?.name === 'string' && t.name.startsWith('action_'));
      const chosen = pickActionTool(userText, actionTools);
      if (chosen) {
        const recordId = extractRecordIdFromMessages(messages, userText);
        if (recordId) {
          const toolCallId = `memory_tc_${Date.now().toString(36)}`;
          return {
            content: '',
            model: options?.model ?? 'memory',
            usage: estimateUsage(messages),
            toolCalls: [
              {
                type: 'tool-call',
                toolCallId,
                toolName: chosen.name,
                input: { recordId },
              } as unknown as NonNullable<AIResult['toolCalls']>[number],
            ],
          };
        }
        // Need a record id but don't have one — fall through to query_data
        // first so we can resolve the target record.
      }
    }

    // ── Step 2: route data questions to `query_data` ──

    if (hasQueryDataTool && !alreadyCalledQueryData && lastUserMessage) {
      const toolCallId = `memory_tc_${Date.now().toString(36)}`;
      return {
        content: '',
        model: options?.model ?? 'memory',
        usage: estimateUsage(messages),
        toolCalls: [
          {
            type: 'tool-call',
            toolCallId,
            toolName: 'query_data',
            input: { request: userText },
          } as unknown as NonNullable<AIResult['toolCalls']>[number],
        ],
      };
    }

    // If a query_data result is already in the conversation, summarise it
    // (or fall through to step 1 if the action wasn't yet routable).
    if (alreadyCalledAction) {
      const lastTool = [...messages].reverse().find(m => m.role === 'tool');
      const part = Array.isArray(lastTool?.content)
        ? (lastTool!.content as Array<{
            toolName?: string;
            output?: { type?: string; value?: unknown };
            result?: unknown;
          }>).find(c => typeof c?.toolName === 'string' && c.toolName.startsWith('action_'))
        : undefined;
      const raw =
        part?.output && typeof part.output === 'object' && 'value' in part.output
          ? part.output.value
          : part?.result;
      let payload: { ok?: boolean; message?: string; error?: string; action?: string } = {};
      if (typeof raw === 'string') {
        try { payload = JSON.parse(raw); } catch { /* leave empty */ }
      } else if (raw && typeof raw === 'object') {
        payload = raw as typeof payload;
      }
      if (payload.error) {
        return {
          content: `[memory] action ${payload.action ?? ''} failed: ${payload.error}`,
          model: options?.model ?? 'memory',
          usage: estimateUsage(messages),
        };
      }
      return {
        content: `[memory] ${payload.message ?? 'Action executed.'} (${payload.action ?? 'action'})`,
        model: options?.model ?? 'memory',
        usage: estimateUsage(messages),
      };
    }

    if (alreadyCalledQueryData) {
      const lastTool = [...messages].reverse().find(m => m.role === 'tool');
      const part = Array.isArray(lastTool?.content)
        ? (lastTool!.content as Array<{
            toolName?: string;
            output?: { type?: string; value?: unknown };
            result?: unknown;
          }>).find(c => c?.toolName === 'query_data')
        : undefined;
      let payload: { records?: unknown[]; count?: number; error?: string } = {};
      const raw =
        part?.output && typeof part.output === 'object' && 'value' in part.output
          ? part.output.value
          : part?.result;
      if (typeof raw === 'string') {
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = {};
        }
      } else if (raw && typeof raw === 'object') {
        payload = raw as typeof payload;
      }
      if (payload.error) {
        return {
          content: `[memory] query_data failed: ${payload.error}`,
          model: options?.model ?? 'memory',
          usage: estimateUsage(messages),
        };
      }
      const records = payload.records ?? [];
      const count = payload.count ?? records.length;
      return {
        content: `[memory] Found ${count} record${count === 1 ? '' : 's'} for "${userText}".`,
        model: options?.model ?? 'memory',
        usage: estimateUsage(messages),
      };
    }

    const content = lastUserMessage
      ? `[memory] ${userText}`
      : '[memory] (no user message)';

    return {
      content,
      model: options?.model ?? 'memory',
      usage: estimateUsage(messages),
    };
  }

  async complete(prompt: string, options?: AIRequestOptions): Promise<AIResult> {
    const content = `[memory] ${prompt}`;
    return {
      content,
      model: options?.model ?? 'memory',
      usage: estimateUsage([{ role: 'user', content: prompt }], content),
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
      totalUsage: estimateUsage(messages, result.content),
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

    // Parse headers of the form `### machine_name — Label (Plural)` emitted
    // by SchemaRetriever.renderSnippet. Capture every alias so we can match
    // against natural-language user queries like "show me my tasks".
    const headerRe = /^###\s+([a-z0-9_]+)(?:\s+—\s+([^\n]+))?/gim;
    type Candidate = { name: string; aliasTokens: Set<string> };
    const candidates: Candidate[] = [];
    for (const match of sys.matchAll(headerRe)) {
      const machineName = match[1];
      if (!machineName) continue;
      const aliasText = match[2] ?? '';
      const aliasTokens = new Set<string>();
      // Tokens from the snake_case machine name
      for (const t of machineName.split(/[^a-z0-9]+/)) {
        if (t) aliasTokens.add(t);
      }
      // Tokens from the label / plural label (everything after the em dash)
      for (const t of aliasText.toLowerCase().split(/[^a-z0-9]+/)) {
        if (t) aliasTokens.add(t);
      }
      // Naive stem: include singular form of plural tokens ending in "s"
      for (const t of [...aliasTokens]) {
        if (t.length > 3 && t.endsWith('s')) aliasTokens.add(t.slice(0, -1));
      }
      candidates.push({ name: machineName, aliasTokens });
    }

    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const userText = typeof lastUser?.content === 'string'
      ? lastUser.content.toLowerCase()
      : '';
    const userTokens = new Set(
      userText.split(/[^a-z0-9_]+/).filter(t => t.length > 1),
    );
    // Apply the same naive plural→singular stem to user tokens so "tasks"
    // also looks up as "task".
    for (const t of [...userTokens]) {
      if (t.length > 3 && t.endsWith('s')) userTokens.add(t.slice(0, -1));
    }

    let chosen = candidates[0]?.name;
    let bestScore = -1;
    for (const cand of candidates) {
      let score = 0;
      for (const tok of cand.aliasTokens) {
        if (userTokens.has(tok)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        chosen = cand.name;
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
          usage: estimateUsage(messages),
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

// ── Heuristic helpers (memory adapter only) ─────────────────────────

/**
 * Naive intent matcher for action-style requests.
 *
 * Returns the best matching `action_*` tool when:
 *   1. user text contains an "action verb" (a token shared with the tool's
 *      name *that isn't the object noun*), AND
 *   2. that match isn't a pure query verb ("show", "list", "find", ...).
 *
 * Query verbs alone are routed to query_data instead.
 */
function pickActionTool(
  userText: string,
  actionTools: Array<{ name: string; description?: string }>,
): { name: string; description?: string } | null {
  if (actionTools.length === 0 || !userText) return null;
  const userTokens = new Set(
    userText
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length > 2),
  );
  // Action verbs imply a write — query verbs alone never route here.
  const ACTION_VERBS = new Set([
    'complete', 'finish', 'done', 'close',
    'start', 'begin', 'resume',
    'clone', 'copy', 'duplicate',
    'cancel', 'abort',
    'archive', 'restore',
    'approve', 'reject',
    'assign', 'unassign',
    'export', 'import',
    'send', 'notify',
    'publish', 'unpublish',
    'mark',
    'delete', 'remove', 'purge', 'destroy', 'erase',
  ]);
  const hasActionVerb = [...userTokens].some(t => ACTION_VERBS.has(t));
  if (!hasActionVerb) return null;

  let best: { name: string; description?: string } | null = null;
  let bestScore = 0;
  for (const tool of actionTools) {
    // Score by overlap on the action verb portion of the tool name. We
    // intentionally weight verbs higher than nouns ("task"/"record"/...)
    // so `action_complete_task` beats `action_clone_task` for "complete
    // my groceries".
    const nameTokens = tool.name
      .replace(/^action_/, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length > 2);
    let score = 0;
    for (const tok of nameTokens) {
      if (!userTokens.has(tok)) continue;
      score += ACTION_VERBS.has(tok) ? 3 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = tool;
    }
  }
  // Require an action-verb match (score ≥ 3) to avoid noun-only false hits.
  return bestScore >= 3 ? best : null;
}

/**
 * Look back through the conversation for a `query_data` tool result and
 * pull a record id out of it. Picks the first record id whose subject /
 * label / name tokens overlap with the user's request — the same
 * heuristic the action picker uses but applied to record fields.
 */
function extractRecordIdFromMessages(
  messages: ModelMessage[],
  userText: string,
): string | undefined {
  const userTokens = userText
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 2);

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'tool' || !Array.isArray(m.content)) continue;
    const parts = m.content as Array<{
      toolName?: string;
      output?: { value?: unknown };
      result?: unknown;
    }>;
    for (const part of parts) {
      if (part?.toolName !== 'query_data') continue;
      const raw =
        part.output && typeof part.output === 'object' && 'value' in part.output
          ? part.output.value
          : part.result;
      let payload: { records?: Array<Record<string, unknown>> } = {};
      if (typeof raw === 'string') {
        try { payload = JSON.parse(raw); } catch { /* ignore */ }
      } else if (raw && typeof raw === 'object') {
        payload = raw as typeof payload;
      }
      const records = payload.records ?? [];
      if (records.length === 0) continue;

      // Pick the record whose text fields best overlap user tokens.
      let bestId: string | undefined;
      let bestScore = -1;
      for (const rec of records) {
        if (!rec || typeof rec !== 'object') continue;
        const id = rec.id;
        if (typeof id !== 'string' && typeof id !== 'number') continue;
        const hay = Object.values(rec)
          .filter((v): v is string => typeof v === 'string')
          .join(' ')
          .toLowerCase();
        const hayTokens = hay.split(/[^a-z0-9]+/).filter(Boolean);
        let score = 0;
        for (const ut of userTokens) {
          if (hayTokens.includes(ut)) score += 1;
        }
        if (score > bestScore) {
          bestScore = score;
          bestId = String(id);
        }
      }
      // Fallback to the first record id when no tokens overlap.
      return bestId ?? String(records[0].id);
    }
  }
  return undefined;
}

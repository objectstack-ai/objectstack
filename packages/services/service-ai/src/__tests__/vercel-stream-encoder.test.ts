// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type { TextStreamPart, ToolSet } from '@objectstack/spec/contracts';
import { encodeStreamPart, encodeVercelDataStream } from '../stream/vercel-stream-encoder.js';

// Helper to parse SSE frame payload
function parseSSE(frame: string): Record<string, unknown> | null {
  if (!frame.startsWith('data: ') || !frame.endsWith('\n\n')) return null;
  const json = frame.slice(6, -2);
  if (json === '[DONE]') return null;
  return JSON.parse(json);
}

// ─────────────────────────────────────────────────────────────────
// encodeStreamPart — individual frame encoding (v6 SSE format)
// ─────────────────────────────────────────────────────────────────

describe('encodeStreamPart', () => {
  it('should encode text-delta as SSE frame', () => {
    const part = { type: 'text-delta', text: 'Hello world' } as TextStreamPart<ToolSet>;
    const frame = encodeStreamPart(part);
    const payload = parseSSE(frame);
    expect(payload).toEqual({ type: 'text-delta', id: '0', delta: 'Hello world' });
  });

  it('should JSON-escape text-delta content', () => {
    const part = { type: 'text-delta', text: 'say "hi"\nnewline' } as TextStreamPart<ToolSet>;
    const frame = encodeStreamPart(part);
    expect(frame.startsWith('data: ')).toBe(true);
    expect(frame.endsWith('\n\n')).toBe(true);

    // Verify round-trip: decode the frame payload back to the original text
    const payload = parseSSE(frame);
    expect(payload).not.toBeNull();
    expect((payload as Record<string, unknown>).delta).toBe('say "hi"\nnewline');
  });

  it('should encode tool-call as tool-input-available SSE frame', () => {
    const part = {
      type: 'tool-call',
      toolCallId: 'call_1',
      toolName: 'get_weather',
      input: { location: 'San Francisco' },
    } as TextStreamPart<ToolSet>;

    const frame = encodeStreamPart(part);
    const payload = parseSSE(frame);
    expect(payload).toEqual({
      type: 'tool-input-available',
      toolCallId: 'call_1',
      toolName: 'get_weather',
      input: { location: 'San Francisco' },
    });
  });

  it('should encode tool-input-start as SSE frame', () => {
    const part = {
      type: 'tool-input-start',
      id: 'call_2',
      toolName: 'search',
    } as TextStreamPart<ToolSet>;

    const frame = encodeStreamPart(part);
    const payload = parseSSE(frame);
    expect(payload).toEqual({
      type: 'tool-input-start',
      toolCallId: 'call_2',
      toolName: 'search',
    });
  });

  it('should encode tool-input-delta as SSE frame', () => {
    const part = {
      type: 'tool-input-delta',
      id: 'call_2',
      delta: '{"query":',
    } as TextStreamPart<ToolSet>;

    const frame = encodeStreamPart(part);
    const payload = parseSSE(frame);
    expect(payload).toEqual({
      type: 'tool-input-delta',
      toolCallId: 'call_2',
      inputTextDelta: '{"query":',
    });
  });

  it('should encode tool-result as tool-output-available SSE frame', () => {
    const part = {
      type: 'tool-result',
      toolCallId: 'call_1',
      toolName: 'get_weather',
      output: { temperature: 72 },
    } as TextStreamPart<ToolSet>;

    const frame = encodeStreamPart(part);
    const payload = parseSSE(frame);
    expect(payload).toEqual({
      type: 'tool-output-available',
      toolCallId: 'call_1',
      output: { temperature: 72 },
    });
  });

  it('encodes a custom data-* part (e.g. build progress) verbatim, with id for reconciliation', () => {
    const part = {
      type: 'data-build-progress',
      id: 'build',
      data: { phase: 'objects', items: [{ type: 'object', name: 'deal', status: 'done' }] },
    } as unknown as TextStreamPart<ToolSet>;
    const payload = parseSSE(encodeStreamPart(part));
    expect(payload).toEqual({
      type: 'data-build-progress',
      id: 'build',
      data: { phase: 'objects', items: [{ type: 'object', name: 'deal', status: 'done' }] },
    });
  });

  it('should return empty string for finish (handled by generator)', () => {
    const part = {
      type: 'finish',
      finishReason: 'stop',
      totalUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      rawFinishReason: 'stop',
    } as unknown as TextStreamPart<ToolSet>;

    expect(encodeStreamPart(part)).toBe('');
  });

  it('should return empty string for finish-step (handled by generator)', () => {
    const part = {
      type: 'finish-step',
      finishReason: 'tool-calls',
      usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
    } as unknown as TextStreamPart<ToolSet>;

    expect(encodeStreamPart(part)).toBe('');
  });

  it('should return empty string for unknown event types', () => {
    const part = { type: 'unknown-internal' } as unknown as TextStreamPart<ToolSet>;
    expect(encodeStreamPart(part)).toBe('');
  });

  it('should encode reasoning-start part with g: prefix', () => {
    const part = {
      type: 'reasoning-start',
      id: 'r1',
    } as unknown as TextStreamPart<ToolSet>;

    const frame = encodeStreamPart(part);
    expect(frame).toBe('g:{"text":""}\n');
  });

  it('should encode reasoning-delta part with g: prefix', () => {
    const part = {
      type: 'reasoning-delta',
      id: 'r1',
      text: 'Let me think through this step by step...',
    } as unknown as TextStreamPart<ToolSet>;

    const frame = encodeStreamPart(part);
    expect(frame).toBe('g:{"text":"Let me think through this step by step..."}\n');
  });

  it('should encode reasoning-end part as empty (no specific end marker)', () => {
    const part = {
      type: 'reasoning-end',
      id: 'r1',
    } as unknown as TextStreamPart<ToolSet>;

    const frame = encodeStreamPart(part);
    expect(frame).toBe('');
  });

  it('should pass through custom step events', () => {
    const part = {
      type: 'step-start',
      stepId: 'step_1',
      stepName: 'Query database',
    } as unknown as TextStreamPart<ToolSet>;

    const frame = encodeStreamPart(part);
    const payload = parseSSE(frame);
    expect(payload).toEqual({
      type: 'step-start',
      stepId: 'step_1',
      stepName: 'Query database',
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// encodeVercelDataStream — async iterable transformation (v6 SSE)
//
// Lifecycle: start → start-step → text-start → ...events... → text-end → finish-step → finish → [DONE]
// ─────────────────────────────────────────────────────────────────

describe('encodeVercelDataStream', () => {
  it('should transform stream events into v6 UI Message Stream frames', async () => {
    async function* source(): AsyncIterable<TextStreamPart<ToolSet>> {
      yield { type: 'text-delta', text: 'Hello' } as TextStreamPart<ToolSet>;
      yield { type: 'text-delta', text: ' world' } as TextStreamPart<ToolSet>;
      yield {
        type: 'finish',
        finishReason: 'stop',
        totalUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        rawFinishReason: 'stop',
      } as unknown as TextStreamPart<ToolSet>;
    }

    const frames: string[] = [];
    for await (const frame of encodeVercelDataStream(source())) {
      frames.push(frame);
    }

    // Preamble: start, start-step, text-start
    // Content: 2 text-deltas
    // Postamble: text-end, finish-step, finish, [DONE]
    expect(frames).toHaveLength(9);

    // Preamble
    expect(parseSSE(frames[0])).toEqual({ type: 'start' });
    expect(parseSSE(frames[1])).toEqual({ type: 'start-step' });
    expect(parseSSE(frames[2])).toEqual({ type: 'text-start', id: '0' });

    // Content
    expect(parseSSE(frames[3])).toMatchObject({ type: 'text-delta', delta: 'Hello' });
    expect(parseSSE(frames[4])).toMatchObject({ type: 'text-delta', delta: ' world' });

    // Postamble
    expect(parseSSE(frames[5])).toEqual({ type: 'text-end', id: '0' });
    expect(parseSSE(frames[6])).toEqual({ type: 'finish-step' });
    expect(parseSSE(frames[7])).toMatchObject({ type: 'finish', finishReason: 'stop' });
    expect(frames[8]).toBe('data: [DONE]\n\n');
  });

  it('should skip events with no wire format mapping', async () => {
    async function* source(): AsyncIterable<TextStreamPart<ToolSet>> {
      yield { type: 'text-delta', text: 'Hi' } as TextStreamPart<ToolSet>;
      yield { type: 'unknown-internal' } as unknown as TextStreamPart<ToolSet>;
      yield {
        type: 'finish',
        finishReason: 'stop',
        totalUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        rawFinishReason: 'stop',
      } as unknown as TextStreamPart<ToolSet>;
    }

    const frames: string[] = [];
    for await (const frame of encodeVercelDataStream(source())) {
      frames.push(frame);
    }

    // Preamble(3) + 1 text-delta + Postamble(4) = 8 ('unknown-internal' dropped)
    expect(frames).toHaveLength(8);
    expect(parseSSE(frames[3])).toMatchObject({ type: 'text-delta', delta: 'Hi' });
  });

  it('should handle empty stream', async () => {
    async function* source(): AsyncIterable<TextStreamPart<ToolSet>> {
      // empty
    }

    const frames: string[] = [];
    for await (const frame of encodeVercelDataStream(source())) {
      frames.push(frame);
    }

    // Preamble(3) + text-end + finish-step + finish + [DONE] = 7
    expect(frames).toHaveLength(7);
    expect(parseSSE(frames[0])).toEqual({ type: 'start' });
    expect(parseSSE(frames[3])).toEqual({ type: 'text-end', id: '0' });
    expect(frames[6]).toBe('data: [DONE]\n\n');
  });

  it('should handle tool-call events in stream', async () => {
    async function* source(): AsyncIterable<TextStreamPart<ToolSet>> {
      yield {
        type: 'tool-call',
        toolCallId: 'call_1',
        toolName: 'search',
        input: { query: 'test' },
      } as TextStreamPart<ToolSet>;
      yield {
        type: 'tool-result',
        toolCallId: 'call_1',
        toolName: 'search',
        output: { hits: 42 },
      } as TextStreamPart<ToolSet>;
      yield {
        type: 'finish',
        finishReason: 'tool-calls',
        totalUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        rawFinishReason: 'tool_calls',
      } as unknown as TextStreamPart<ToolSet>;
    }

    const frames: string[] = [];
    for await (const frame of encodeVercelDataStream(source())) {
      frames.push(frame);
    }

    // Preamble(3) + tool-input-available + tool-output-available + Postamble(4) = 9
    expect(frames).toHaveLength(9);

    // Verify tool-call frame content
    const toolCallPayload = parseSSE(frames[3]);
    expect(toolCallPayload).toMatchObject({
      type: 'tool-input-available',
      toolCallId: 'call_1',
      toolName: 'search',
      input: { query: 'test' },
    });

    const toolResultPayload = parseSSE(frames[4]);
    expect(toolResultPayload).toMatchObject({
      type: 'tool-output-available',
      toolCallId: 'call_1',
      output: { hits: 42 },
    });
  });
});

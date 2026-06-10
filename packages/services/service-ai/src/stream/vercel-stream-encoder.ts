// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Vercel AI SDK v6 — UI Message Stream Encoder
 *
 * Converts `AsyncIterable<TextStreamPart<ToolSet>>` (the internal ObjectStack
 * streaming format) into the Vercel AI SDK v6 **UI Message Stream Protocol**.
 *
 * Wire format: Server-Sent Events (SSE) with JSON payloads.
 *   `data: {"type":"text-delta","id":"0","delta":"Hello"}\n\n`
 *
 * The client-side `DefaultChatTransport` from `ai` v6 uses
 * `parseJsonEventStream` to parse these SSE events.
 *
 * @see https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
 */

import type { TextStreamPart, ToolSet } from 'ai';

// ── SSE helpers ──────────────────────────────────────────────────────

function sse(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Encode data using Vercel AI SDK Data Stream Protocol prefixes.
 * @see https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
 */
function dataStreamLine(prefix: string, data: object): string {
  return `${prefix}:${JSON.stringify(data)}\n`;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Encode a single `TextStreamPart` event into SSE-formatted UI Message
 * Stream chunk(s).
 *
 * Returns an empty string for event types that have no wire-format mapping.
 */
export function encodeStreamPart(part: TextStreamPart<ToolSet>): string {
  switch (part.type) {
    case 'text-delta':
      return sse({ type: 'text-delta', id: '0', delta: part.text });

    case 'tool-input-start':
      return sse({
        type: 'tool-input-start',
        toolCallId: part.id,
        toolName: part.toolName,
      });

    case 'tool-input-delta':
      return sse({
        type: 'tool-input-delta',
        toolCallId: part.id,
        inputTextDelta: part.delta,
      });

    case 'tool-call':
      return sse({
        type: 'tool-input-available',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
      });

    case 'tool-result':
      return sse({
        type: 'tool-output-available',
        toolCallId: part.toolCallId,
        output: part.output,
      });

    case 'error':
      return sse({
        type: 'error',
        errorText: String(part.error),
      });

    // Handle reasoning/thinking streams (DeepSeek R1, o1-style models)
    // Use 'g:' prefix for reasoning content per Vercel AI SDK protocol
    case 'reasoning-start':
      return dataStreamLine('g', { text: '' });

    case 'reasoning-delta':
      return dataStreamLine('g', { text: part.text });

    case 'reasoning-end':
      return ''; // No specific end marker needed for reasoning

    // finish-step and finish are handled by the generator, not here
    default:
      // Custom data parts (Vercel UI-message-stream `data-*`) — e.g. a tool's
      // mid-execution progress (`data-build-progress`). Emit verbatim with the
      // optional `id` (present ⇒ the client RECONCILES/replaces the part).
      if (typeof (part as any).type === 'string' && (part as any).type.startsWith('data-')) {
        const p = part as { type: string; id?: string; data?: unknown };
        return sse({ type: p.type, ...(p.id ? { id: p.id } : {}), data: p.data });
      }
      // Pass through any unknown event types that might be custom
      // (e.g., step-start, step-finish from custom providers)
      if ((part as any).type?.startsWith('step-')) {
        return sse(part as any);
      }
      return '';
  }
}

/**
 * Transform an `AsyncIterable<TextStreamPart>` into an `AsyncIterable<string>`
 * where each yielded string is an SSE-formatted UI Message Stream chunk.
 *
 * Lifecycle order required by the client:
 *   start → start-step → text-start → text-delta* → text-end → finish-step → finish → [DONE]
 */
export async function* encodeVercelDataStream(
  events: AsyncIterable<TextStreamPart<ToolSet>>,
): AsyncIterable<string> {
  // Preamble
  yield sse({ type: 'start' });
  yield sse({ type: 'start-step' });
  yield sse({ type: 'text-start', id: '0' });

  let textOpen = true;
  let finishReason = 'stop';
  let errorMessage: string | undefined;

  try {
    for await (const part of events) {
      // Surface error parts emitted by the underlying provider stream.
      if ((part as { type: string }).type === 'error') {
        const errPart = part as unknown as { error?: unknown };
        const raw = errPart.error;
        errorMessage =
          (raw && typeof raw === 'object' && 'message' in raw
            ? String((raw as { message: unknown }).message)
            : typeof raw === 'string'
              ? raw
              : 'Unknown provider error');
        finishReason = 'error';
        break;
      }

      // Capture finish reason
      if (part.type === 'finish') {
        finishReason = part.finishReason ?? 'stop';
      }

      // Before finish-step/finish, close the text part first
      if (part.type === 'finish-step' || part.type === 'finish') {
        if (textOpen) {
          yield sse({ type: 'text-end', id: '0' });
          textOpen = false;
        }
        // Don't emit these via encodeStreamPart — we handle them in postamble
        continue;
      }

      const frame = encodeStreamPart(part);
      if (frame) {
        yield frame;
      }
    }
  } catch (err) {
    // Upstream provider threw (auth failure, network error, etc.). Without
    // this catch the SSE response would hang half-open and the client would
    // never leave its "streaming" state.
    errorMessage = err instanceof Error ? err.message : String(err);
    finishReason = 'error';
  }

  // Close text if still open (safety)
  if (textOpen) {
    yield sse({ type: 'text-end', id: '0' });
  }

  // If we recorded an error, emit it as a UI Message Stream `error` part so
  // the client can display it instead of spinning forever.
  if (errorMessage) {
    yield sse({ type: 'error', errorText: errorMessage });
  }

  // Postamble — always emit so the client transitions out of "streaming".
  yield sse({ type: 'finish-step' });
  yield sse({ type: 'finish', finishReason });
  yield 'data: [DONE]\n\n';
}

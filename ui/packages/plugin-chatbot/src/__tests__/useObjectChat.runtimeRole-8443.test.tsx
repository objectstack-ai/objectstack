/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `useObjectChat` — the API-mode builder PERFORMS the `'tool'` -> `'assistant'`
 * fold instead of asserting it away (objectui#8443).
 *
 * ## Why this file exists at all
 *
 * The authoring contract accepts `role: 'tool'`, `normalizeMessages`
 * deliberately does not narrow it, and `renderer.tsx` hands `schema.messages`
 * straight through as `initialMessages`. So an authored `'tool'` message
 * reaches the `aiInitialMessages` builder, and in API mode the builder's output
 * is what seeds the AI SDK store. Until this card the builder wrote
 * `as 'user' | 'assistant' | 'system'` over it — the store was handed a value
 * out of its own union with the compiler told not to look.
 *
 * `useObjectChat.honestMessages.test.tsx:157-167` already authors a `'tool'`
 * message, but in LOCAL mode, where the builder's output never reaches
 * `useChat`. That is the leg this file adds: `api` IS set, so the assertions
 * below read the seed the store actually receives.
 *
 * ## What was measured before the fold was chosen
 *
 * Against the real `@ai-sdk/react` (4.0.68) / `ai` (7.0.65), an authored
 * `role: 'tool'`:
 *
 *   - is held by the client store VERBATIM — nothing recognises it, nothing
 *     renders it distinctly, nothing folds it (lit control: three in-union
 *     roles read back distinct through the same instrument);
 *   - is REJECTED by the SDK's own two downstream entry points, both of which
 *     a backend route calls on exactly these values — `convertToModelMessages`
 *     throws `AI_MessageConversionError: Unsupported role: tool`, and
 *     `validateUIMessages` throws `AI_TypeValidationError` naming
 *     `["system","user","assistant"]` at `[0].role`.
 *
 * So the fold is a fix and not a regression. The third test below keeps that
 * measurement in the suite rather than in a commit message: it runs the SDK's
 * OWN validator over the builder's output, with the pre-fix value as its
 * control.
 */

import { renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { validateUIMessages } from 'ai';
import { useObjectChat } from '../useObjectChat';

const API = 'https://example.test/api/v1/ai/agents/build/chat';

/** What the builder handed `useChat` on the render under test. */
type SeededMessage = { id: string; role: string; parts: Array<Record<string, unknown>> };

const { seen } = vi.hoisted(() => ({ seen: { messages: undefined as SeededMessage[] | undefined } }));

vi.mock('@ai-sdk/react', () => ({
  // The store seed is the thing under test, so the double captures the option
  // rather than inventing a thread: `messages` IS what `useChat` initialises
  // its store from (measured on the real SDK — it is held verbatim).
  useChat: (options: { messages?: SeededMessage[] }) => {
    seen.messages = options?.messages;
    return {
      messages: [],
      status: 'ready',
      error: undefined,
      sendMessage: vi.fn(),
      regenerate: vi.fn(),
      stop: vi.fn(),
      setMessages: vi.fn(),
    };
  },
}));

beforeEach(() => {
  seen.messages = undefined;
});

describe("API mode: an authored 'tool' role is folded before it seeds the store", () => {
  it('folds it on the content path (the branch that goes through normalizeMessages)', () => {
    const { result } = renderHook(() =>
      useObjectChat({
        api: API,
        initialMessages: [
          { id: 'a-tool', role: 'tool', content: 'tool said x' },
        ],
      }),
    );

    expect(result.current.isApiMode).toBe(true);
    // The seed the SDK store receives. Before objectui#8443 this read 'tool' —
    // a value outside the store's own union, declared as one of three roles it
    // is not.
    expect(seen.messages?.[0]).toMatchObject({ id: 'a-tool', role: 'assistant' });
    // The fold moves the ROLE only; the content still renders.
    expect(seen.messages?.[0]?.parts).toEqual([{ type: 'text', text: 'tool said x' }]);
  });

  it('folds it on the pre-built `parts` path too (the other assertion)', () => {
    // The builder has two arms and the card names both: an authored message
    // that already carries `parts` short-circuits `normalizeMessages`. Fixing
    // one arm and not the other would leave the defect reachable from any
    // schema that authors `parts`.
    renderHook(() =>
      useObjectChat({
        api: API,
        initialMessages: [
          {
            id: 'a-tool-parts',
            role: 'tool',
            content: '',
            parts: [{ type: 'text', text: 'already parted' }],
          },
        ],
      }),
    );

    expect(seen.messages?.[0]).toMatchObject({ id: 'a-tool-parts', role: 'assistant' });
  });

  it('LIT CONTROL — the other three roles reach the store unchanged', () => {
    // Without this the two assertions above are satisfied by a builder that
    // hard-codes 'assistant', which would destroy the centred system pill and
    // mis-attribute every user turn. `'system'` is the one that matters most:
    // `<Chatbot>` renders it distinctly, so folding it would be a real
    // regression rather than a no-op.
    renderHook(() =>
      useObjectChat({
        api: API,
        initialMessages: [
          { id: 'a-user', role: 'user', content: 'u' },
          { id: 'a-assistant', role: 'assistant', content: 'a' },
          { id: 'a-system', role: 'system', content: 's' },
          { id: 'a-tool', role: 'tool', content: 't' },
        ],
      }),
    );

    expect(seen.messages?.map((m) => m.role)).toEqual(['user', 'assistant', 'system', 'assistant']);
  });

  it("the seed passes the SDK's OWN UIMessage validator — with the pre-fix value as control", async () => {
    renderHook(() =>
      useObjectChat({
        api: API,
        initialMessages: [
          { id: 'a-user', role: 'user', content: 'u' },
          { id: 'a-tool', role: 'tool', content: 'tool said x' },
        ],
      }),
    );

    const seeded = seen.messages ?? [];
    expect(seeded).toHaveLength(2);

    // SUBJECT: `validateUIMessages` is the SDK's own statement of what its
    // store may hold, and it is what a backend route runs over these values.
    await expect(
      validateUIMessages({ messages: seeded as never }),
    ).resolves.toHaveLength(2);

    // CONTROL: the SAME call over the SAME messages with the role the builder
    // used to emit. If this ever stops rejecting, the SDK has started accepting
    // a fourth role and this card's premise has changed — which is a review
    // conversation, not something to discover by the subject going quiet.
    const preFix = seeded.map((m) => (m.id === 'a-tool' ? { ...m, role: 'tool' } : m));
    await expect(validateUIMessages({ messages: preFix as never })).rejects.toThrow(
      /role/i,
    );
  });
});

/**
 * ## Ground 2 — the compile-time tripwire — is NOT pinned here, on purpose
 *
 * Deleting the two `as` casts did more than fix a runtime lie: it put
 * `toRuntimeRole` back on the builder's path, and `chatMessageAdapter.ts`
 * records what that buys — "a new authored `role` makes {@link toRuntimeRole}
 * unassignable". An `as 'user' | 'assistant' | 'system'` let a future role past
 * these two lines silently; the fold does not.
 *
 * That alarm needs no assertion from this file, because it is not a claim about
 * values — it is the type-check gate itself. MEASURED by ablation on this
 * branch: widening `ChatMessage['role']` with one extra member and rebuilding
 * `@object-ui/types` makes `pnpm --filter @object-ui/plugin-chatbot type-check`
 * fail with
 *
 *   src/chatMessageAdapter.ts(188,42): error TS2322: Type '"system" | "user" |
 *   "assistant" | "<new>"' is not assignable to type '"system" | "user" |
 *   "assistant"'.
 *
 * — the doc's sentence, verbatim, from the compiler.
 *
 * A separate type-level pin was written here and then REMOVED, because the only
 * shape it could take encodes the wrong invariant. `Exclude<AuthoredRole,
 * 'tool'> extends RuntimeRole` says "the fold handles exactly `'tool'`", not
 * "the fold is total": a contributor who meets the new role correctly — by
 * folding it too — makes `toRuntimeRole` compile again and makes that pin red.
 * A pin that reddens on the correct fix is a nuisance, not an alarm, and the
 * union's own spelling is already pinned by
 * `chat-message-contract.test.ts`'s `Equal<AuthoredChatMessage['role'], …>`.
 */

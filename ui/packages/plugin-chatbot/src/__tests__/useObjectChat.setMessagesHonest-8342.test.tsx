/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `useObjectChat().setMessages` — the deliberately-loose member tells the truth
 * (objectui#8342).
 *
 * The hook declared `setMessages?: (messages: unknown[]) => void` and returned
 * the AI SDK's own function, which accepts only its `UIMessage[]`. Parameters
 * are CONTRAVARIANT, so that assignment is unsound and `tsc` said so — the one
 * thing suppressing it was a `chatResult as any` at the destructure. The fix
 * keeps the loose parameter (this package does not republish `@ai-sdk/react`'s
 * pinned `UIMessage`) and narrows INSIDE the hook, so the promise on the
 * surface is one the implementation keeps.
 *
 * Two halves, and they only mean something together:
 *
 *   - the COMPILE-TIME block pins the declaration. It is erased by vitest, so
 *     `pnpm test` proves nothing about it; only
 *     `pnpm --filter @object-ui/plugin-chatbot type-check` can, and this
 *     package's `tsconfig.test.json` is the project that reads this file.
 *   - the RUNTIME blocks pin what the declaration is now a statement ABOUT.
 *     Pinning either alone reproduces exactly the blindness that shipped: a
 *     declaration that disagreed with the values flowing through it.
 *
 * The contract under test on a non-surviving element is REFUSE LOUDLY, not
 * filter and not pass through. See the member's doc comment in
 * `useObjectChat.ts` for why; the assertions below are what stops a later
 * change from quietly picking one of the other two.
 */

import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useObjectChat, type UseObjectChatReturn } from '../useObjectChat';

const API = 'https://example.test/api/v1/ai/agents/build/chat';

const { sdkSetMessages } = vi.hoisted(() => ({ sdkSetMessages: vi.fn() }));

vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: [],
    status: 'ready',
    error: undefined,
    sendMessage: vi.fn(),
    regenerate: vi.fn(),
    stop: vi.fn(),
    setMessages: sdkSetMessages,
  }),
}));

/** A thread as the server persists it — `id` / `role` / `parts`, the three members `UIMessage` requires. */
const HYDRATED = [
  { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'build me an app' }] },
  {
    id: 'm2',
    role: 'assistant',
    parts: [
      { type: 'text', text: 'Built your app.' },
      // An open `data-*` part: author-defined payload, no closed union to check
      // against. It must survive — the guard checks `parts` for array-ness only.
      { type: 'data-build-progress', id: 'bp-1', data: { phase: 'done' } },
    ],
  },
];

function renderApiMode() {
  return renderHook(() => useObjectChat({ api: API, conversationId: 'c1' }));
}

beforeEach(() => {
  sdkSetMessages.mockClear();
});

// ---------------------------------------------------------------------------
// Compile-time: the declaration itself. Erased at runtime — `type-check` reads
// these, vitest does not.
// ---------------------------------------------------------------------------
type Assert<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

type Published = UseObjectChatReturn['setMessages'];

// Probe hygiene first: an `any` anywhere on this member would make every
// assertion below answer whatever it is asked.
type _NotAny = Assert<Equal<IsAny<Published>, false>>;
type _NotAnyParam = Assert<Equal<IsAny<Parameters<NonNullable<Published>>[0]>, false>>;

// Optional, because local mode does not expose it at all.
type _StillOptional = Assert<Equal<undefined extends Published ? true : false, true>>;

// The card, as a type. `(messages: unknown[]) => void` and nothing else:
// re-narrowing this to the SDK's `UIMessage[]` is option A, which the ruling
// declined precisely so a dependency bump cannot move the published surface.
type _HonestSignature = Assert<Equal<NonNullable<Published>, (messages: unknown[]) => void>>;

// The parameter really is the top array type — a caller may hand over anything
// an `unknown[]` can hold, and the compiler must not object.
type _AcceptsUnknownArray = Assert<
  Equal<Parameters<NonNullable<Published>>[0], unknown[]>
>;

describe('the returned setMessages belongs to the hook, not to the SDK', () => {
  it('is a wrapper, so what the declaration promises is enforced somewhere', () => {
    const { result } = renderApiMode();
    // Lit control for the negative below: the member is present and callable.
    expect(typeof result.current.setMessages).toBe('function');
    // The whole shape of the fix. Before it, this WAS the SDK's function and
    // the declared parameter was a promise nothing kept.
    expect(result.current.setMessages).not.toBe(sdkSetMessages);
  });
});

describe('a well-formed thread passes through untouched', () => {
  it('forwards every element, in order, by identity', () => {
    const { result } = renderApiMode();

    act(() => {
      result.current.setMessages?.(HYDRATED);
    });

    expect(sdkSetMessages).toHaveBeenCalledTimes(1);
    const [forwarded] = sdkSetMessages.mock.calls[0] as [unknown[]];
    // Not filtered, not re-shaped: same length, same elements, same order.
    expect(forwarded).toHaveLength(HYDRATED.length);
    expect(forwarded[0]).toBe(HYDRATED[0]);
    expect(forwarded[1]).toBe(HYDRATED[1]);
    // The open `data-*` part survived — `parts` is checked for array-ness only.
    expect((forwarded[1] as { parts: unknown[] }).parts).toHaveLength(2);
  });
});

describe('a non-message element is REFUSED, not filtered and not passed on', () => {
  it('throws a TypeError naming the offending index', () => {
    const { result } = renderApiMode();

    expect(() => result.current.setMessages?.([HYDRATED[0], { oops: true }])).toThrow(TypeError);
    expect(() => result.current.setMessages?.([HYDRATED[0], { oops: true }])).toThrow(
      /index 1/,
    );
  });

  it('writes NOTHING — the store never sees a truncated thread', () => {
    const { result } = renderApiMode();

    expect(() => result.current.setMessages?.([HYDRATED[0], { oops: true }])).toThrow();

    // The anti-FILTER pin, and the reason the check runs over the whole array
    // before anything is handed on. A filtering implementation would have
    // called the SDK exactly once here, with the single surviving message —
    // installing a shorter thread that the `void` return makes undetectable.
    expect(sdkSetMessages).not.toHaveBeenCalled();
  });

  it.each([
    ['a null hole', null],
    ['a primitive', 'not a message'],
    ['no id', { role: 'user', parts: [] }],
    ['a non-string id', { id: 7, role: 'user', parts: [] }],
    ['an unknown role', { id: 'm', role: 'tool', parts: [] }],
    ['no parts', { id: 'm', role: 'user' }],
    ['a non-array parts', { id: 'm', role: 'user', parts: { type: 'text' } }],
  ])('refuses %s', (_label, bad) => {
    const { result } = renderApiMode();
    expect(() => result.current.setMessages?.([bad])).toThrow(TypeError);
    expect(sdkSetMessages).not.toHaveBeenCalled();
  });

  it('refuses a non-array argument too', () => {
    const { result } = renderApiMode();
    // A JS host can reach a published surface with anything. The declared type
    // says `unknown[]`; the implementation says so out loud.
    const setMessages = result.current.setMessages as unknown as (m: unknown) => void;
    expect(() => setMessages(null)).toThrow(TypeError);
    expect(sdkSetMessages).not.toHaveBeenCalled();
  });
});

describe('the in-hook caller still works through the wrapper', () => {
  it('clear() empties the thread — an empty array survives the narrowing', () => {
    const { result } = renderApiMode();

    act(() => {
      result.current.clear();
    });

    expect(sdkSetMessages).toHaveBeenCalledTimes(1);
    expect(sdkSetMessages).toHaveBeenCalledWith([]);
  });
});

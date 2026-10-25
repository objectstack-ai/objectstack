/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The authoring -> runtime chat-message adapter (objectui#4399).
 *
 * Each narrowing decision in `chatMessageAdapter.ts` gets a test here, so the
 * decisions are recorded as behaviour and not only as prose. The compile-time
 * half of the seam (the adapter's output IS the runtime contract; the authoring
 * shape is NOT directly assignable to it) lives in `chat-message-contract.test.ts`
 * beside PR #4400's pins — vitest erases type assertions, so they belong with
 * the other `tsc`-only ones.
 */

import { describe, it, expect } from 'vitest';
import type { ChatMessage as AuthoredChatMessage } from '@object-ui/types';
import {
  authoredToRuntimeMessage,
  toRuntimeMessages,
  toRuntimeRole,
  toRuntimeTimestamp,
  toRuntimeToolInvocation,
  toRuntimeToolState,
  type SeamChatMessage,
} from '../chatMessageAdapter';

const base: AuthoredChatMessage = { id: 'm1', role: 'user', content: 'hi' };

describe('role: the tool -> assistant decision (objectui#4399)', () => {
  it("folds the authoring-only 'tool' role onto the assistant role", () => {
    // The NAMED decision. Before the adapter this was an implicit fallthrough
    // inside `formatMessageProps`; a 'tool' message is an assistant message as
    // far as the runtime contract is concerned, and its content still renders.
    expect(toRuntimeRole('tool')).toBe('assistant');
    expect(authoredToRuntimeMessage({ ...base, role: 'tool', content: 'tool said x' })).toMatchObject(
      { role: 'assistant', content: 'tool said x' },
    );
  });

  it('leaves the three shared roles alone', () => {
    // 'system' in particular keeps its own role: `<Chatbot>` renders it as a
    // centred pill, which folding it to 'assistant' here would destroy.
    expect(toRuntimeRole('user')).toBe('user');
    expect(toRuntimeRole('assistant')).toBe('assistant');
    expect(toRuntimeRole('system')).toBe('system');
  });
});

describe('timestamp: the Date -> ISO absorption, expressed once', () => {
  it('converts a Date to an ISO string', () => {
    const at = new Date('2026-08-12T02:08:13.000Z');
    expect(toRuntimeTimestamp(at)).toBe('2026-08-12T02:08:13.000Z');
    expect(authoredToRuntimeMessage({ ...base, timestamp: at }).timestamp).toBe(
      '2026-08-12T02:08:13.000Z',
    );
  });

  it('passes a string through and leaves undefined undefined', () => {
    expect(toRuntimeTimestamp('10:31:00')).toBe('10:31:00');
    expect(toRuntimeTimestamp(undefined)).toBeUndefined();
  });

  it('drops a value that is neither string nor Date instead of throwing', () => {
    // Authored JSON is not type-checked at runtime. The pre-adapter code had
    // this same `instanceof` guard; an unconditional `.toISOString()` would
    // turn a bad authored timestamp into a crash instead of a missing one.
    const notATimestamp = 1755000000000 as unknown as Date;
    expect(toRuntimeTimestamp(notATimestamp)).toBeUndefined();
  });
});

describe('toolInvocations: the legacy state vocabulary (the fourth drift)', () => {
  it('maps the three legacy states onto their v6 equivalents', () => {
    // The mapping the authoring type's own doc comment declares.
    expect(toRuntimeToolState('partial-call')).toBe('input-streaming');
    expect(toRuntimeToolState('call')).toBe('input-available');
    expect(toRuntimeToolState('result')).toBe('output-available');
  });

  it('leaves the v6 states and an absent state alone', () => {
    expect(toRuntimeToolState('approval-requested')).toBe('approval-requested');
    expect(toRuntimeToolState('output-error')).toBe('output-error');
    expect(toRuntimeToolState(undefined)).toBeUndefined();
  });

  it('narrows state without disturbing the rest of the invocation', () => {
    const runtime = toRuntimeToolInvocation({
      toolCallId: 'call_1',
      toolName: 'create_object',
      args: { name: 'Loan' },
      result: { status: 'ok' },
      state: 'result',
    });
    expect(runtime).toEqual({
      toolCallId: 'call_1',
      toolName: 'create_object',
      args: { name: 'Loan' },
      result: { status: 'ok' },
      state: 'output-available',
    });
  });
});

describe('pass-through: the API-mode payload survives the seam', () => {
  // In API mode `useObjectChat` hands the renderer messages carrying keys the
  // authoring contract does not declare. The `as any` casts preserved them by
  // accident; the adapter must preserve them on purpose, or the HITL approval
  // card, the "Review N changes" affordance and the build panel all vanish from
  // the SDUI renderers.
  //
  // objectui#4424 — read the ANNOTATION, it is half the test. This fixture used
  // to need `as unknown as AuthoredChatMessage`: the authoring type declares
  // none of these keys, so the only way to hand them to the adapter was to
  // assert past the compiler, which is the same blindness the hook's own
  // `as OuiChatMessage[]` had. `SeamChatMessage` names them, so the fixture is
  // now type-checked: misspell `buildProgress`, or give `draftReview` the wrong
  // shape, and this file goes red at compile time instead of quietly testing a
  // payload the seam was never going to see.
  const apiModeMessage: SeamChatMessage = {
    id: 'm2',
    role: 'assistant',
    content: 'built it',
    metadata: { conversationId: 'c1' },
    buildProgress: { phase: 'done', items: [], done: 3, total: 3 },
    charts: [{ chartType: 'bar', data: [], series: [] }],
    toolInvocations: [
      {
        toolCallId: 'call_2',
        toolName: 'apply_blueprint',
        state: 'output-available',
        pendingActionId: 'pa_1',
        draftReview: { items: [{ type: 'object', name: 'Loan' }] },
      },
    ],
  };

  it('keeps the runtime-only message keys', () => {
    const runtime = authoredToRuntimeMessage(apiModeMessage);
    expect(runtime.buildProgress).toEqual({ phase: 'done', items: [], done: 3, total: 3 });
    expect(runtime.charts).toHaveLength(1);
  });

  it('keeps the runtime-only tool-invocation extensions', () => {
    const [tool] = authoredToRuntimeMessage(apiModeMessage).toolInvocations ?? [];
    expect(tool?.pendingActionId).toBe('pa_1');
    expect(tool?.draftReview?.items).toEqual([{ type: 'object', name: 'Loan' }]);
  });

  it('keeps `metadata`, which the runtime contract does not declare', () => {
    // Graded decision (objectui#4399): the runtime never reads `metadata` —
    // there is no `{...message}` spread and no key walk in the package — so
    // carrying it is inert either way. It is passed through rather than
    // stripped because `useObjectChat` splices it in deliberately, and
    // stripping it would be a change this typing card has no reason to make.
    const runtime = authoredToRuntimeMessage(apiModeMessage) as { metadata?: unknown };
    expect(runtime.metadata).toEqual({ conversationId: 'c1' });
  });
});

describe('toRuntimeMessages', () => {
  it('maps an array and tolerates an absent one', () => {
    expect(toRuntimeMessages(undefined)).toEqual([]);
    expect(
      toRuntimeMessages([
        { ...base, role: 'tool', timestamp: new Date('2026-08-12T02:08:13.000Z') },
      ]),
    ).toEqual([
      {
        id: 'm1',
        role: 'assistant',
        content: 'hi',
        timestamp: '2026-08-12T02:08:13.000Z',
        toolInvocations: undefined,
      },
    ]);
  });
});

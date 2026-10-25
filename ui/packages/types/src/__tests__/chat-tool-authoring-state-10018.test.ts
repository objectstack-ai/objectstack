// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The authoring `ChatToolInvocation.state` union sheds the three runtime-only
 * approval states (objectui#10018 — the residual clause of the objectui#8426
 * ruling, decision batch #86).
 *
 * The ruling, verbatim: "the authoring `state` union sheds the three
 * runtime-only approval states, so a schema-authored invocation cannot claim
 * `approval-requested` without an envelope". `approval-requested`,
 * `approval-responded` and `output-denied` are produced by a chat RUNTIME — from
 * the AI SDK's approval envelope, or promoted from an ObjectStack pending-action
 * result — and are never authored. Shedding them refuses the claim outright,
 * so an authored invocation carrying an envelope is refused too: the envelope
 * does not make a runtime-only state authorable.
 *
 * ## What is pinned, and why each pin is the one that can fail
 *
 * 1. TYPE-LEVEL refusal. Each `@ts-expect-error` below is a claim that the
 *    literal is NOT assignable; while the state is still in the union the
 *    directive is unused and `tsc -p tsconfig.test.json` fails with TS2578.
 *    vitest erases these, so only this package's `type-check` reads them.
 * 2. PARSE-LEVEL refusal, judged as a VALUE. `ChatToolInvocationSchema` is a
 *    strip-mode `z.object`, so a `success: false` alone could come from any
 *    member. Each refusal is therefore asserted to be exactly one
 *    `invalid_value` issue at `state` — the judgment the narrowing makes, not
 *    some other member failing beside it.
 * 3. CONTROLS on the same instruments: an ordinary v6 state, a legacy
 *    authoring state and a state-less invocation stay accepted, both as a type
 *    and as a full `safeParse` success. Without them the refusals above could
 *    be the schema refusing everything.
 */

import { describe, it, expect } from 'vitest';
import { ChatMessageSchema, ChatToolInvocationSchema } from '../zod/complex.zod';
import type { ChatMessage, ChatToolInvocation } from '../complex';

const RUNTIME_ONLY_STATES = ['approval-requested', 'approval-responded', 'output-denied'] as const;

/** The envelope each state carries in the AI SDK's own tool-part union. */
const ENVELOPE_FOR: Record<(typeof RUNTIME_ONLY_STATES)[number], Record<string, unknown>> = {
  'approval-requested': { id: 'apr_10018' },
  'approval-responded': { id: 'apr_10018', approved: true },
  'output-denied': { id: 'apr_10018', approved: false },
};

const BASE = { toolCallId: 'tc-10018', toolName: 'action_delete_task' } as const;

// ── 1. Type-level refusal ─────────────────────────────────────────────────────
// One literal per line: a `@ts-expect-error` covers only the line after it.

// @ts-expect-error — `approval-requested` is runtime-only, envelope-less
export const requestedBare: ChatToolInvocation = { ...BASE, state: 'approval-requested' };
// @ts-expect-error — `approval-requested` is runtime-only, envelope or not
export const requestedEnveloped: ChatToolInvocation = { ...BASE, state: 'approval-requested', approval: { id: 'apr_10018' } };
// @ts-expect-error — `approval-responded` is runtime-only, envelope-less
export const respondedBare: ChatToolInvocation = { ...BASE, state: 'approval-responded' };
// @ts-expect-error — `approval-responded` is runtime-only, envelope or not
export const respondedEnveloped: ChatToolInvocation = { ...BASE, state: 'approval-responded', approval: { id: 'apr_10018', approved: true } };
// @ts-expect-error — `output-denied` is runtime-only, envelope-less
export const deniedBare: ChatToolInvocation = { ...BASE, state: 'output-denied' };
// @ts-expect-error — `output-denied` is runtime-only, envelope or not
export const deniedEnveloped: ChatToolInvocation = { ...BASE, state: 'output-denied', approval: { id: 'apr_10018', approved: false } };

// The same refusal reaches an authored MESSAGE, which is where a schema author
// actually writes an invocation (`ChatbotSchema.messages`).
export const authoredMessage: ChatMessage = {
  id: 'm-10018',
  role: 'assistant',
  content: '',
  // @ts-expect-error — the runtime-only state is refused inside a message too
  toolInvocations: [{ ...BASE, state: 'approval-requested', approval: { id: 'apr_10018' } }],
};

// CONTROLS — these must keep compiling.
export const controlV6: ChatToolInvocation = { ...BASE, state: 'output-available', result: { ok: true } };
export const controlLegacy: ChatToolInvocation = { ...BASE, state: 'call', args: { id: 1 } };
export const controlError: ChatToolInvocation = { ...BASE, state: 'output-error', errorText: 'boom' };
export const controlStateless: ChatToolInvocation = { ...BASE };

// ── 2. Parse-level refusal ────────────────────────────────────────────────────

function expectStateRefused(
  result: ReturnType<typeof ChatToolInvocationSchema.safeParse> | ReturnType<typeof ChatMessageSchema.safeParse>,
  path: ReadonlyArray<string | number>,
): void {
  expect(result.success).toBe(false);
  if (result.success) return;
  expect(result.error.issues.map((i) => ({ code: i.code, path: i.path }))).toEqual([
    { code: 'invalid_value', path: [...path] },
  ]);
}

describe('the authoring mirror REFUSES the three runtime-only approval states (objectui#10018)', () => {
  for (const state of RUNTIME_ONLY_STATES) {
    it(`refuses \`${state}\` with no envelope`, () => {
      expectStateRefused(ChatToolInvocationSchema.safeParse({ ...BASE, state }), ['state']);
    });

    it(`refuses \`${state}\` WITH its envelope — the envelope does not make it authorable`, () => {
      expectStateRefused(
        ChatToolInvocationSchema.safeParse({ ...BASE, state, approval: ENVELOPE_FOR[state] }),
        ['state'],
      );
    });

    it(`refuses \`${state}\` inside an authored message`, () => {
      expectStateRefused(
        ChatMessageSchema.safeParse({
          id: 'm-10018',
          role: 'assistant',
          content: '',
          toolInvocations: [{ ...BASE, state }],
        }),
        ['toolInvocations', 0, 'state'],
      );
    });
  }
});

describe('CONTROLS — ordinary authoring states stay accepted on the same instrument', () => {
  it('accepts a v6 lifecycle state', () => {
    const parsed = ChatToolInvocationSchema.safeParse({ ...BASE, state: 'output-available', result: { ok: true } });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.state).toBe('output-available');
  });

  it('accepts a legacy authoring state', () => {
    const parsed = ChatToolInvocationSchema.safeParse({ ...BASE, state: 'call', args: { id: 1 } });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.state).toBe('call');
  });

  it('accepts an invocation that declares no state', () => {
    expect(ChatToolInvocationSchema.safeParse({ ...BASE }).success).toBe(true);
  });

  it('accepts an ordinary state inside an authored message', () => {
    const parsed = ChatMessageSchema.safeParse({
      id: 'm-10018',
      role: 'assistant',
      content: '',
      toolInvocations: [{ ...BASE, state: 'output-error', errorText: 'boom' }],
    });
    expect(parsed.success).toBe(true);
  });
});

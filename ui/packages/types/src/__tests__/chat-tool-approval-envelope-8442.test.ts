// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ChatToolInvocation.approval` — declared, mirrored, and OPTIONAL (objectui#8442).
 *
 * ## What is pinned, and why each pin is the one that can fail
 *
 * The member exists because three AI SDK approval states —
 * `approval-requested`, `approval-responded`, `output-denied` — are states the
 * SDK's own tool-part union cannot express WITHOUT this envelope. The
 * hydration mapper in `@object-ui/app-shell` carried those states through while
 * dropping the envelope, so the state survived the hop and the data that makes
 * it actionable did not. Those three states are RUNTIME-ONLY and are shed from
 * the authoring `state` union (objectui#10018), so every fixture below rides an
 * authorable state — `output-available`, which the SDK's union lets carry an
 * already-decided envelope.
 *
 * 1. RETENTION, not `success`. `ChatToolInvocationSchema` is a plain `z.object`
 *    — STRIP mode — so `safeParse` is green for an undeclared key too; it just
 *    deletes it. A `.success` assertion therefore cannot tell "declared" from
 *    "silently dropped", and the control below demonstrates exactly that on the
 *    same instrument. Reading the key back OUT of `data` is the assertion that
 *    fails when the mirror has not been widened.
 * 2. VALUE judgment, separately. `id` is the envelope's only required member,
 *    so a payload missing it must be REFUSED rather than stripped-and-green —
 *    and refused AT `approval.id`: while the fixtures rode a state the mirror
 *    now refuses, a `success: false` here would have been the state's refusal
 *    masking an id judgment that never ran, so the issue path is asserted.
 * 3. OPTIONALITY, and its limit. No authorable state requires the envelope, so
 *    an invocation without one parses. The three states that DO require it are
 *    not authorable at all: objectui#10018 shed them rather than pairing them
 *    with this member, so they are refused with or without an envelope. The
 *    type-level half of that refusal is pinned in
 *    `chat-tool-authoring-state-10018.test.ts`.
 *
 * The TS-side/Zod-side KEY parity is not restated here: `zod-mirror-parity.test.ts`
 * registers this pair and derives its key census from the mirror's own `.shape`,
 * so a member added on one side only fails there with no list to maintain.
 */

import { describe, it, expect } from 'vitest';
import { ChatToolInvocationSchema } from '../zod/complex.zod';
import type { ChatToolInvocation } from '../complex';

const ENVELOPE = {
  id: 'apr_8442',
  approved: true,
  reason: 'operator confirmed',
  isAutomatic: false,
  signature: 'sig_abc',
} as const;

function invocation(extra: Record<string, unknown> = {}) {
  return {
    toolCallId: 'tc-1',
    toolName: 'action_delete_task',
    state: 'output-available',
    ...extra,
  };
}

describe('ChatToolInvocation.approval — the mirror declares it', () => {
  it('KEEPS a full envelope on the parsed output (strip mode: an undeclared key would be gone)', () => {
    const parsed = ChatToolInvocationSchema.safeParse(invocation({ approval: ENVELOPE }));
    expect(parsed.success).toBe(true);
    // The load-bearing line. Before the mirror was widened this read `undefined`
    // while `success` stayed `true`.
    expect(parsed.success && parsed.data.approval).toEqual(ENVELOPE);
  });

  it('CONTROL — an undeclared sibling key is stripped while `success` stays true', () => {
    // Same instrument, same fixture shape, a key nothing declares. This is what
    // the assertion above would read if `approval` were still unmirrored, and it
    // is why `success` alone proves nothing here.
    const parsed = ChatToolInvocationSchema.safeParse(
      invocation({ approvalEnvelope: ENVELOPE }),
    );
    expect(parsed.success).toBe(true);
    expect(parsed.success && 'approvalEnvelope' in parsed.data).toBe(false);
  });

  it('keeps a MINIMAL envelope — only `id` is required', () => {
    const parsed = ChatToolInvocationSchema.safeParse(
      invocation({ approval: { id: 'apr_min' } }),
    );
    expect(parsed.success && parsed.data.approval).toEqual({ id: 'apr_min' });
  });

  it('REFUSES an envelope without a usable `id` — a value judgment, not a strip', () => {
    // Judged AT `approval.id`, and nowhere else: the fixture's state is
    // authorable, so a refusal elsewhere would mean this case measured the
    // wrong thing (objectui#10018 — it once rode a state the mirror refuses).
    const noId = ChatToolInvocationSchema.safeParse(invocation({ approval: { approved: true } }));
    expect(noId.success).toBe(false);
    expect(noId.success ? [] : noId.error.issues.map((i) => i.path)).toEqual([['approval', 'id']]);
    const wrongType = ChatToolInvocationSchema.safeParse(invocation({ approval: { id: 42 } }));
    expect(wrongType.success).toBe(false);
    expect(wrongType.success ? [] : wrongType.error.issues.map((i) => i.path)).toEqual([
      ['approval', 'id'],
    ]);
  });

  it('is OPTIONAL on an authorable state — and the three runtime-only states are REFUSED, envelope or not', () => {
    // The optional half: an authorable state parses with no envelope.
    const bare = ChatToolInvocationSchema.safeParse(invocation());
    expect(bare.success).toBe(true);
    expect(bare.success && bare.data.approval).toBeUndefined();

    // The refusal half (objectui#10018): the states that REQUIRE the envelope
    // are runtime-only, so the envelope does not make them authorable.
    for (const state of ['approval-requested', 'approval-responded', 'output-denied'] as const) {
      for (const extra of [{}, { approval: { id: 'apr_8442', approved: state !== 'output-denied' } }]) {
        const parsed = ChatToolInvocationSchema.safeParse(invocation({ state, ...extra }));
        expect(parsed.success).toBe(false);
        expect(
          parsed.success ? [] : parsed.error.issues.map((i) => ({ code: i.code, path: i.path })),
        ).toEqual([{ code: 'invalid_value', path: ['state'] }]);
      }
    }
  });
});

describe('ChatToolInvocation.approval — the declaration admits what the mirror keeps', () => {
  it('type-checks the full and the minimal envelope', () => {
    const full: ChatToolInvocation = {
      toolCallId: 'tc-1',
      toolName: 'action_delete_task',
      state: 'output-available',
      approval: { ...ENVELOPE },
    };
    const minimal: ChatToolInvocation = {
      toolCallId: 'tc-2',
      toolName: 'action_delete_task',
      approval: { id: 'apr_min' },
    };
    // `id` is non-optional on the declared envelope; the two values above are
    // the compile-time statement and these reads keep them from being elided.
    expect(full.approval?.id).toBe('apr_8442');
    expect(minimal.approval?.approved).toBeUndefined();
  });
});

/**
 * ObjectUI — `useSettledSchema` republishes an EQUAL payload as the SAME
 * object (objectui#10106)
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ## What this file pins, and why a COUNT
 *
 * `AGENTS.md` §5 commandment #10 closes with the producer half of its ruling:
 * *"a provider that refetches may not republish an equal payload as a new
 * object, and a consumer that needs stability keys on the data, not on a
 * cache"*. This hook is such a provider — it re-reads `getObjectSchema`
 * whenever the adapter identity changes, and every consumer the hook's own doc
 * comment instructs (`ObjectGantt`, `ObjectCalendar`, `ObjectView`,
 * `ObjectTimeline`, `ObjectGallery`) keys its record fetch on `def`, which is
 * the CORRECT half of #10: keying on the payload, not on a memo identity.
 *
 * So the cost of a fresh-object republish lands on the consumer as a DUPLICATE
 * RECORD QUERY — and the count is what the next reader has to be told by a red
 * test rather than by a card. `ObjectGantt`'s own gate pin
 * (`ObjectGantt.fetchGate-7225.test.tsx`) counts `find` calls for the MOUNT
 * path only and deliberately does not pin this one, so nothing else in the
 * tree goes red on the day this regresses.
 *
 * ## The reading this file was written from (objectui#10106, first-hand)
 *
 * Measured on the REAL consumer, `ObjectGantt`, with an instrumented adapter,
 * swapping the adapter on provider `object` — three cases in ONE command, so
 * that 「two」 is a discrimination and not a counting artefact:
 *
 *   byte-identical answer as a FRESH object → 2 `find`, expand `[['owner'], ['owner']]`
 *   the SAME def object from both adapters  → 1 `find`, expand `[['owner']]`
 *   a genuinely DIFFERENT def               → 2 `find`, expand `[['owner'], ['owner','account']]`
 *
 * The middle row is the control that makes the top row a finding: the harness
 * counts ONE when the producer keeps the payload's identity, so the extra query
 * is the republish and nothing else. The bottom row is the one where two
 * queries are WARRANTED — the second carries an expand set the first could not
 * have — which is why the repair may never be "fetch less".
 *
 * ⚠️ Where the FIRST of those two queries comes from, since it is easy to
 * misread: `ready` is `resolution.key === key`, and an adapter swap does not
 * move the key — so `ready` stays TRUE right through the swap and a consumer's
 * gate does not hold anything back. The first query goes out immediately, on
 * the definition already in hand; the republish is what adds the second.
 *
 * ## The consumer harness below is the hook's OWN published recipe
 *
 * `useSettledSchema`'s doc comment carries an `@example` whose fetch effect
 * lists `objectSchemaReady` and `objectSchema` in its dependency list. The
 * harness here is that example, reduced to the one thing being counted. It
 * keys on the PAYLOAD, never on a `useMemo`/`useCallback` identity — so a
 * duplicate query through it is the producer's, by construction.
 */

import React, { useEffect } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, renderHook, waitFor } from '@testing-library/react';
import { useSettledSchema } from '../useSettledSchema';

/** A definition with a lookup, so a gated query has a real `$expand` to carry. */
const TASK_DEF = {
  name: 'task',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text' },
    owner: { name: 'owner', type: 'lookup', reference: 'user' },
  },
};

/** The same answer, byte for byte, as a FRESH object — what a real adapter returns. */
const freshTaskDef = () => JSON.parse(JSON.stringify(TASK_DEF));

/** A genuinely different answer: one more expandable relation. */
const WIDER_TASK_DEF = {
  ...TASK_DEF,
  fields: {
    ...TASK_DEF.fields,
    account: { name: 'account', type: 'lookup', reference: 'account' },
  },
};

function makeAdapter(answer: () => any) {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    getObjectSchema: vi.fn(async () => answer()),
  } as any;
}

/** The expand set a consumer derives from a definition — one declared lookup per entry. */
function expandOf(def: any): string[] {
  return Object.values((def?.fields ?? {}) as Record<string, any>)
    .filter((f: any) => f?.type === 'lookup')
    .map((f: any) => f.name);
}

/**
 * The hook's published `@example`, reduced to the query it issues. Gate
 * placement stays the caller's (objectui#6482); what matters here is that the
 * effect keys on `def` — the payload — which is what #10 tells a consumer to do.
 */
function RecipeConsumer({ objectName, dataSource }: { objectName: string; dataSource: any }) {
  const { ready, def } = useSettledSchema<any>(objectName, dataSource);

  useEffect(() => {
    if (!ready) return;
    const expand = expandOf(def);
    void dataSource.find(objectName, expand.length > 0 ? { $expand: expand } : {});
  }, [ready, def, dataSource, objectName]);

  return null;
}

/** Every expand set issued through one adapter, in order. */
function expandSets(adapter: any): Array<unknown> {
  return adapter.find.mock.calls.map(([, params]: [string, any]) => params?.$expand ?? null);
}

/**
 * Swap the adapter on a mounted recipe consumer and report what the NEW
 * adapter was asked for. Identical in every respect but the answer the two
 * adapters give, which is the single variable across the three cases below.
 */
async function swapAdapter(answerA: () => any, answerB: () => any) {
  const a = makeAdapter(answerA);
  const b = makeAdapter(answerB);

  const { rerender } = render(<RecipeConsumer objectName="task" dataSource={a} />);
  await waitFor(() => expect(a.find).toHaveBeenCalledTimes(1));

  rerender(<RecipeConsumer objectName="task" dataSource={b} />);
  await waitFor(() => expect(b.getObjectSchema).toHaveBeenCalledTimes(1));
  // Let every effect the settle can trigger run before reading the count —
  // waiting only for the FIRST query would read 1 on defect and fix alike.
  await waitFor(() => expect(b.find).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 50));

  return { a, b, queries: b.find.mock.calls.length, expands: expandSets(b) };
}

describe('objectui#10106 — an equal metadata answer is republished as the same object', () => {
  // -------------------------------------------------------------------
  // The producer contract itself.
  // -------------------------------------------------------------------

  it('an adapter swap answering BYTE-IDENTICALLY publishes the SAME `def` object', async () => {
    const a = makeAdapter(freshTaskDef);
    const b = makeAdapter(freshTaskDef);

    const { result, rerender } = renderHook(({ ds }) => useSettledSchema<any>('task', ds), {
      initialProps: { ds: a },
    });

    await waitFor(() => expect(result.current.ready).toBe(true));
    const settledFirst = result.current.def;
    expect(settledFirst).toEqual(TASK_DEF);

    rerender({ ds: b });
    // An adapter swap does not move the KEY, so `ready` never drops here — the
    // consumer's gate holds nothing back and its first query goes out at once,
    // on the definition already in hand. (Contrast the key-change case, pinned
    // as NOT ready in the same render by `useSettledSchema.test.ts`.)
    expect(result.current.ready).toBe(true);
    await waitFor(() => expect(b.getObjectSchema).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The new adapter WAS read — this is not "the refetch was skipped".
    expect(b.getObjectSchema).toHaveBeenCalledWith('task');
    // ...and its equal answer reaches consumers as the object they already hold.
    expect(result.current.def).toBe(settledFirst);
  });

  it('a genuinely DIFFERENT answer still publishes a NEW object — the control for the pin above', async () => {
    const a = makeAdapter(freshTaskDef);
    const b = makeAdapter(() => WIDER_TASK_DEF);

    const { result, rerender } = renderHook(({ ds }) => useSettledSchema<any>('task', ds), {
      initialProps: { ds: a },
    });

    await waitFor(() => expect(result.current.ready).toBe(true));
    const settledFirst = result.current.def;

    rerender({ ds: b });
    await waitFor(() => expect(result.current.def).toEqual(WIDER_TASK_DEF));
    expect(result.current.def).not.toBe(settledFirst);
  });

  // -------------------------------------------------------------------
  // The COUNT — the card's own acceptance, with its control in the same file
  // and, for the two swap cases, in one shared harness.
  // -------------------------------------------------------------------

  it('costs ONE record query when the swapped adapter answers byte-identically', async () => {
    const { queries, expands } = await swapAdapter(freshTaskDef, freshTaskDef);

    expect(queries).toBe(1);
    expect(expands).toEqual([['owner']]);
  });

  it('CONTROL — the same def OBJECT from both adapters costs ONE query too', async () => {
    const { queries, expands } = await swapAdapter(
      () => TASK_DEF,
      () => TASK_DEF,
    );

    expect(queries).toBe(1);
    expect(expands).toEqual([['owner']]);
  });

  it('CONTROL — a genuinely different def still costs TWO, and the second carries the wider expand', async () => {
    const { queries, expands } = await swapAdapter(freshTaskDef, () => WIDER_TASK_DEF);

    // Two queries are WARRANTED here: the first could not have carried
    // `account`, which the new adapter's definition declares.
    expect(queries).toBe(2);
    expect(expands).toEqual([['owner'], ['owner', 'account']]);
  });
});

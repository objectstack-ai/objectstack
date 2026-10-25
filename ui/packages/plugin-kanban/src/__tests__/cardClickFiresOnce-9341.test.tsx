/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One card click runs an authored `onCardClick` EXACTLY ONCE, and the call it
 * survives as carries the modifier event (objectui#9341, maintainer ruling on
 * the card, 2026-09-13).
 *
 * ## The defect
 *
 * `ObjectKanban` handed the same function to `useNavigationOverlay` as its
 * `onRowClick` and then called it again itself:
 *
 *     const externalClick = onRowClick ?? onCardClick;
 *     const navigation = useNavigationOverlay({ …, onRowClick: externalClick });
 *     …
 *     onCardClick: (card, event) => {
 *       navigation.handleClick(card, event);
 *       onCardClick?.(card);            // ⛔ the second call
 *     }
 *
 * `handleClick` gives `onRowClick` FULL PRIORITY — it calls it and RETURNS — so
 * for a host that supplies `onCardClick` and no `onRowClick`, that one function
 * is both the value of `externalClick` and the one the next line calls. One
 * click, two calls. Measured 2 by objectui#9338's pin, which relaxed its own
 * control to "it RAN" so that this repair would not redden a file that is not
 * about it; that control is tightened back to the exact count in the same diff
 * as this file.
 *
 * ## The ruling, and why the two calls are NOT interchangeable
 *
 * RULING: drop the wrapper's second call. `externalClick` keeps its
 * `onCardClick` arm.
 *
 * `handleClick` forwards `onRowClick(record, event)`, so a host can implement
 * Cmd/Ctrl/middle-click; the wrapper's second call passed the record ONLY. The
 * surviving channel is therefore the RICHER one, which is leg 2's subject — and
 * the reason the published `ObjectKanbanSchema.onCardClick` declaration grows a
 * second optional parameter in this same change.
 *
 * The same shape one surface over is already the ruling's spelling:
 * `ObjectGallery` (`packages/plugin-list/src/ObjectGallery.tsx`) writes
 * `onRowClick: props.onRowClick ?? props.onCardClick` into the identical hook
 * and has NO second call.
 *
 * ## ⚠️ The consequence the card's text did not state — measured in leg 3
 *
 * The ruling's rationale says precedence is left alone, so a board inside an
 * `ObjectView` "behaves exactly as today". That is true of the PRECEDENCE
 * EXPRESSION and FALSE of the authored handler's call count: when a parent
 * supplies `onRowClick` AND the document carries `onCardClick`, the authored
 * one ran ONCE before this change (the wrapper called it) and runs ZERO times
 * after it — the parent's handler wins OUTRIGHT, which is what
 * `onRowClick ?? onCardClick` has always said and what nothing enforced. Leg 3
 * pins that reading rather than leaving it to be discovered.
 *
 * ## Every control here can fire
 *
 * A count of 1 is only a reading if the instrument can report something else.
 * Leg 1 carries the sibling `onCardMove` spy at 0 on the SAME render, so the 1
 * is about this key and not a recorder that counts every key once; leg 4 drives
 * the same handler TWICE and reads 2, so the counter demonstrably moves.
 *
 * ⚠️ No leg here depends on a throw. React 19 REPORTS a handler error out of
 * the dispatch rather than rethrowing it, so an `expect(...).toThrow()` leg on
 * this path could never fire.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import type { ObjectKanbanSchema } from '@object-ui/types';
import '../index';

/** Every props object the board implementation was rendered with, in order. */
const recorded = vi.hoisted(() => ({ impl: [] as Array<Record<string, unknown>> }));

// The lazy board chunk is a prop recorder: the question is how many times the
// handler the board was HANDED runs the authored one, not what the board draws.
vi.mock('../KanbanImpl', () => ({
  default: (props: Record<string, unknown>) => {
    recorded.impl.push(props);
    return null;
  },
}));

const STATIC_COLUMNS = [{ id: 'todo', title: 'To Do', cards: [{ id: '1', title: 'One' }] }];

/**
 * Author a document on the PRODUCTION path — `SchemaRenderer` resolves the
 * registry key and spreads every non-metadata schema key as a React prop — and
 * return the props the board implementation was handed last.
 */
async function boardPropsFor(schemaKeys: Record<string, unknown>) {
  const before = recorded.impl.length;
  const { unmount } = render(
    <SchemaRendererProvider dataSource={undefined}>
      <SchemaRenderer
        schema={
          {
            type: 'object-kanban',
            columns: STATIC_COLUMNS,
            ...schemaKeys,
          } as never
        }
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(recorded.impl.length).toBeGreaterThan(before));
  const received = recorded.impl[recorded.impl.length - 1];
  unmount();
  return received;
}

/** The handler the board implementation was handed, driven as a card click. */
type BoardClick = (card: unknown, event?: unknown) => void;

describe('objectui#9341 — an authored `onCardClick` runs ONCE per card click', () => {
  it('⭐ ONE click, ONE call — with the sibling `onCardMove` spy at 0 on the same render', async () => {
    const onCardClick = vi.fn();
    const onCardMove = vi.fn();
    const card = { id: '1', title: 'One' };

    // ONE document, ONE render. The sibling key is the firing control: a
    // recorder that counted every authored handler once would show 1 here too,
    // and `onCardMove` reaches nothing on this arm (objectui#7804), so a 0
    // beside the 1 is what makes the 1 a reading about THIS key.
    const props = await boardPropsFor({ onCardClick, onCardMove });
    (props.onCardClick as BoardClick)(card);

    expect(
      { cardClick: onCardClick.mock.calls.length, cardMove: onCardMove.mock.calls.length },
      'the authored `onCardClick` must run exactly once per card click',
    ).toEqual({ cardClick: 1, cardMove: 0 });
  });

  it('⭐ the surviving call carries the MODIFIER EVENT — the whole reason it is the one kept', async () => {
    const onCardClick = vi.fn();
    const card = { id: '1', title: 'One' };
    // What `KanbanImpl` forwards is the DOM click event
    // (`onClick={(e) => onCardClick?.(card, e)}`); only the three modifier
    // fields are ever read, so a structural stand-in measures the channel.
    const event = { metaKey: true, ctrlKey: false, button: 0 };

    const props = await boardPropsFor({ onCardClick });
    (props.onCardClick as BoardClick)(card, event);

    expect(
      onCardClick.mock.calls.map((args) => ({ arity: args.length, record: args[0], event: args[1] })),
      'the kept channel is `handleClick`’s `onRowClick(record, event)` — the dropped one passed the record only',
    ).toEqual([{ arity: 2, record: card, event }]);
  });

  it('⚠️ a parent `onRowClick` wins OUTRIGHT — the authored `onCardClick` no longer also runs', async () => {
    const onRowClick = vi.fn();
    const onCardClick = vi.fn();
    const card = { id: '1', title: 'One' };

    // Both reach `ObjectKanban` as React props on this path — `SchemaRenderer`
    // spreads every non-metadata key and `ObjectKanbanRenderer` forwards its
    // rest — which is the shape an `ObjectView`-embedded board has, with the
    // parent supplying `onRowClick`.
    const props = await boardPropsFor({ onRowClick, onCardClick });
    (props.onCardClick as BoardClick)(card);

    // ⛔ NOT a regression smuggled in: `externalClick = onRowClick ?? onCardClick`
    // is untouched by this card and has always said the parent's handler wins.
    // What changed is that the loser no longer ALSO fires.
    expect(
      { rowClick: onRowClick.mock.calls.length, cardClick: onCardClick.mock.calls.length },
      'precedence is `onRowClick ?? onCardClick`; exactly one handler answers one click',
    ).toEqual({ rowClick: 1, cardClick: 0 });
  });

  it('CONTROL — the counter moves: two clicks read 2', async () => {
    const onCardClick = vi.fn();
    const card = { id: '1', title: 'One' };

    const props = await boardPropsFor({ onCardClick });
    (props.onCardClick as BoardClick)(card);
    (props.onCardClick as BoardClick)(card);

    expect(onCardClick.mock.calls.length, 'a count leg whose count cannot move measures nothing').toBe(2);
  });
});

/* ── The published face, judged by `tsc -p tsconfig.test.json` ───────────── */

/**
 * ⭐ The published-surface half of this card, MEASURED rather than asserted in
 * prose. `ObjectKanbanSchema.onCardClick` grew a second optional parameter
 * because the surviving channel delivers `(record, event)`; the prediction
 * offered with the ruling was that such a widening is source-compatible. These
 * four lines are that prediction handed to `tsc`, and the last one is the
 * control that keeps the other three from being vacuously true.
 *
 * ⛔ `event` is `any`, not `HandleClickModifiers`: that interface lives in
 * `@object-ui/react`, which depends on `@object-ui/types` and is named in no
 * dependency field of it — `check:phantom-deps` rejects the import and it would
 * close a cycle. `BaseSchema`'s own `onClick` / `onChange` / `onSubmit`
 * already spell this exact situation the same way.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type Assignable<From, To> = [From] extends [To] ? true : false;
type CardClick = NonNullable<ObjectKanbanSchema['onCardClick']>;

export type assertion9341PublishedSignatureIsSourceCompatible = [
  /** WIDENING direction: a host's existing one-argument handler still fits. */
  Expect<Assignable<(card: any) => void, CardClick>>,
  /** The reverse: code that stores the member in a one-argument slot still compiles. */
  Expect<Assignable<CardClick, (card: any) => void>>,
  /** The arity the channel actually delivers is now declared. */
  Expect<Assignable<CardClick, (card: any, event?: any) => void>>,
  /** CONTROL — `Assignable` can answer `false`: a REQUIRED second parameter does not fit. */
  Expect<Equal<Assignable<(card: any, event: any) => void, (card: any) => void>, false>>,
];

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Which authored `on*` keys reach a registered kanban board — measured, per
 * registration — and the guard that a bare deletion of one of them goes red on
 * (objectui#7664; the contract-review remediation of PR #7743).
 *
 * ## What went wrong, and why a hand-written ledger could not see it
 *
 * The first cut of this card removed `onCardClick` from the successor
 * `'kanban'` arm outright, on the recorded rationale "the object-bound board
 * owns the click". `BaseSchema` is `.passthrough()`, so a removed key is not
 * refused — it stops being judged and the value is KEPT. Measured on the built
 * dist at that head, `{ type: 'kanban', columns: [], onCardClick: { action:
 * 'toast' } }` went from REFUSED to ACCEPTED, with the value surviving into the
 * parsed output, while `onCardMove` / `onQuickAdd` / `onColumnAdd` /
 * `draggable` stayed REFUSED. Every ratchet stayed green because the #6124
 * ledger lists keys BY NAME and by hand: substituting one entry for another
 * holds its length constant and no assertion is derived from the read site.
 * Suite 3 below is that missing derivation.
 *
 * ## ⭐ What the 2026-09-09 family retirement did to this file
 *
 * Three of the four registrations this file measured RETIRED — the bare
 * `kanban` node key (objectui#8802) and the `kanban-ui` / `kanban-enhanced`
 * variants (objectui#8257) — and the zod `'kanban'` arm retired with the first
 * of them. ⛔ The MECHANISM the file exists to guard did not retire with them,
 * so the legs were re-based rather than deleted:
 *
 *   - the per-registration reachability probes collapse to the ONE surviving
 *     key, `'object-kanban'`;
 *   - `KanbanRenderer` is still a live component (`ObjectKanban` renders it),
 *     so its identity-forward probe is kept and driven DIRECTLY instead of
 *     through a registry key that no longer exists;
 *   - suite 3's derivation survives intact and its VERDICT flips, which is the
 *     honest reading: the three forwarded keys had exactly one declaring face,
 *     the `'kanban'` arm, and with the arm gone they have NONE. Recorded as an
 *     assertion so the state cannot drift back silently, and reported on the
 *     retirement PR rather than repaired here — declaring them on
 *     `ObjectKanbanSchema` would WIDEN a published accept set, which is a
 *     ruling and not a repair.
 *
 * ## ⭐ What objectui#7804 then did to suite 3
 *
 * The ruling arrived (director seat, decision batch #69, 2026-09-07) and the
 * dispositions were measured per key on this face. TWO landed —
 * `onCardClick` and `onQuickAdd`, both objectui#6124 RUNTIME SLOTS — so suite
 * 3's verdict flips a second time, and it is now spelled PER KEY: `onCardMove`
 * is still declared by nothing, because its authored value reaches neither
 * channel and the gate of record refuses the `'retired'` spelling while this
 * file's own forward block still reads the key. The separate per-key evidence
 * lives in `./handlerKeyDispositionsMeasured-7804.test.tsx`; what stays here is
 * the DERIVATION from the read site, which is the thing a re-key cannot hold
 * constant.
 *
 * ## What objectui#8932 removed from this file
 *
 * The prop recorder for the `KanbanEnhanced` chunk, deleted with that module.
 * No leg read it once `kanban-enhanced` retired: every probe below records the
 * `KanbanImpl` chunk, so no assertion moved or went.
 *
 * ## Suite 1 — runtime reachability, per registration
 *
 * The lazy board chunk is replaced by a prop recorder; three spies are
 * authored on the schema; the question is which of them reach the board.
 *
 *   - `KanbanRenderer` rendered directly (`../index.tsx`): all three arrive BY
 *     IDENTITY. This is the probe whose controls are lit — `onCardMove` and
 *     `onQuickAdd`, both kept as #6124 runtime slots, come out live on it, and
 *     `onCardClick` comes out live beside them off the same forward block.
 *   - `'object-kanban'` (registered to `ObjectKanbanRenderer` → `ObjectKanban`
 *     → `KanbanBoardCore` since objectui#11234, `KanbanRenderer` before it):
 *     `onCardClick` AND `onCardMove` are BOTH replaced by `ObjectKanban`'s own
 *     functions. The two keys have the SAME reachability here, so
 *     "`ObjectKanban` overrides it" cannot retire one without retiring the
 *     other. ⭐ `onQuickAdd` arrived by identity on this key until
 *     objectui#11234, and that was the lit control proving the schema-spread
 *     channel reached the board. It now reaches NOTHING: `ObjectKanban` renders
 *     the internal `KanbanBoardCore`, which takes the Quick Add pair only as
 *     explicit props, and passes neither. The lit control on that leg is the
 *     same render's `onCardClick`, which is a function.
 *
 * ## Suite 2 — the prop channel, which only `onCardClick` has
 *
 * `SchemaRenderer` spreads every non-metadata schema key as a React prop
 * (`packages/react/src/SchemaRenderer.tsx`, the `...componentProps` line of its
 * `createElement` call), and `ObjectKanbanComponentProps` DECLARES
 * `onCardClick` — there is no `onCardMove` prop. So on the `'object-kanban'` key an
 * authored `onCardClick` is not merely overridden: `ObjectKanban`'s own
 * wrapper RUNS it. Suite 2 invokes the function the board was handed and
 * measures that the authored one runs, with the identity check from suite 1 as
 * the control that the wrapper is genuinely interposed.
 *
 * ⚠️ Since objectui#9341 the wrapper reaches it INDIRECTLY — it calls
 * `useNavigationOverlay`'s `handleClick`, which gives the same function full
 * priority as its `onRowClick` and calls it with `(record, event)`. The wrapper
 * used to ALSO call it directly with the record alone, which ran one authored
 * handler twice per click; that second call is gone. Nothing about the CHANNEL
 * this file measures changed: the prop still reaches, and the authored function
 * still runs.
 *
 * ⇒ On every channel measured, `onCardClick` is at least as live as
 * `onCardMove`. Its #6124 disposition is RUNTIME SLOT, not `?: never`.
 *
 * ## Suite 3 — derived from the read site, so a deletion cannot hide
 *
 * The `schema.on*` reads are extracted from the source of the two components
 * that read the document. Nothing here is a list a re-key can hold constant:
 * the read site is measured, and each key's declaration status on the
 * surviving `object-kanban` face is measured beside it.
 *
 * ⭐ Since objectui#11234 the reads live in TWO bodies, and which body a read
 * sits in decides its disposition. `KanbanBoardCore` (`../KanbanBoardCore.tsx`)
 * is the board every `object-kanban` entry point reaches, and it reads
 * `onCardClick`, a runtime slot. `KanbanRenderer` (`../index.tsx`) adds the Quick
 * Add pair for a React host, and no registration reaches it, so its
 * `onQuickAdd` read is the host's, and the `object-kanban` face tombstones the
 * key.
 *
 * ## Predictions, written before the first run (red-first)
 *
 * On the tree before the remediation (`bd1fc7111` merged with `main`):
 *   - suites 1 and 2 pass unchanged — the forwards and the prop wiring are not
 *     what this card moved;
 *   - suite 3 fails on exactly one key, `onCardClick`: forwarded by
 *     `KanbanRenderer`, absent from `KanbanSchema.shape`.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { ObjectKanbanSchema as ObjectKanbanZod } from '@object-ui/types/zod';
import { KanbanRenderer } from '../index';
import '../index';

/** Every props object the board implementation was rendered with, in order. */
const recorded = vi.hoisted(() => ({
  impl: [] as Array<Record<string, unknown>>,
}));

// The lazy board chunk is replaced by a prop recorder: the question this file
// asks is what reaches the board's props, not what the board draws with them.
vi.mock('../KanbanImpl', () => ({
  default: (props: Record<string, unknown>) => {
    recorded.impl.push(props);
    return null;
  },
}));

const STATIC_COLUMNS = [{ id: 'todo', title: 'To Do', cards: [{ id: '1', title: 'One' }] }];

function authored() {
  return { onCardClick: vi.fn(), onCardMove: vi.fn(), onQuickAdd: vi.fn() };
}

/** Wait for one more board render to be recorded, then return the props it got. */
async function lastBoardProps(log: keyof typeof recorded, before: number, unmount: () => void) {
  await waitFor(() => expect(recorded[log].length).toBeGreaterThan(before));
  const received = recorded[log][recorded[log].length - 1];
  unmount();
  return received;
}

/**
 * Render the REGISTERED renderer for `type` directly with an authored board,
 * and return the props its board implementation was handed last. The provider
 * is what `ObjectKanbanRenderer`'s `useSchemaContext()` requires; its
 * `dataSource` is explicitly `undefined` because these boards author their
 * lanes statically and nothing here fetches. (The prop is required and typed
 * `any`, so the value has to be spelled rather than omitted.)
 */
async function boardPropsFor(type: string, log: keyof typeof recorded, schemaKeys: Record<string, unknown>) {
  const Renderer = ComponentRegistry.get(type) as React.ComponentType<Record<string, unknown>>;
  expect(Renderer, `\`${type}\` is not registered`).toBeDefined();
  const before = recorded[log].length;
  const { unmount } = render(
    <SchemaRendererProvider dataSource={undefined}>
      <Renderer schema={{ type, columns: STATIC_COLUMNS, quickAdd: true, ...schemaKeys }} />
    </SchemaRendererProvider>,
  );
  return lastBoardProps(log, before, unmount);
}

/**
 * Render `KanbanRenderer` DIRECTLY with an authored board and return the props
 * its board implementation was handed last.
 *
 * ⚠️ Direct rather than through a registry key, and that is a re-based
 * instrument rather than a weakened one: `kanban-ui` — the key this probe used
 * to reach the component through — RETIRED (objectui#8257). The component is
 * unchanged, still exported, and still rendered by `ObjectKanban`, so the
 * forward block being measured is identical; what is gone is one lookup hop.
 */
async function kanbanRendererProps(schemaKeys: Record<string, unknown>) {
  const before = recorded.impl.length;
  const { unmount } = render(
    <SchemaRendererProvider dataSource={undefined}>
      <KanbanRenderer schema={{ type: 'object-kanban', columns: STATIC_COLUMNS, quickAdd: true, ...schemaKeys }} />
    </SchemaRendererProvider>,
  );
  return lastBoardProps('impl', before, unmount);
}

/**
 * The production path: author the key on the DOCUMENT and let `SchemaRenderer`
 * route it. This is the channel that turns an authored `onCardClick` into a
 * React prop on the registered renderer.
 */
async function boardPropsViaSchemaRenderer(schema: Record<string, unknown>) {
  const before = recorded.impl.length;
  const { unmount } = render(
    <SchemaRendererProvider dataSource={undefined}>
      <SchemaRenderer schema={schema as never} />
    </SchemaRendererProvider>,
  );
  return lastBoardProps('impl', before, unmount);
}

describe('which authored handler keys reach a registered kanban board (objectui#7664)', () => {
  it('KanbanRenderer forwards onCardClick and onQuickAdd off the schema bag by identity', async () => {
    // ⚠️ Driven DIRECTLY rather than through a registry key: `kanban-ui`
    // retired (objectui#8257). The component is unchanged and still live —
    // `ObjectKanban` renders it — so the forward block this leg measures is the
    // same one it always measured.
    //
    // ⭐ objectui#9342 — `onCardMove` LEFT this leg, and its absence is the
    // change rather than a gap. It is no longer read off the `schema` bag at
    // all: `KanbanRendererProps` declares it as an explicit React PROP, a
    // sibling of `schema`, so a key written INSIDE `schema` reaches nothing.
    // The leg below measures both directions on the same render.
    const spies = authored();
    const props = await kanbanRendererProps(spies);
    expect({
      onCardClick: props.onCardClick === spies.onCardClick,
      onQuickAdd: props.onQuickAdd === spies.onQuickAdd,
    }).toEqual({ onCardClick: true, onQuickAdd: true });
  });

  it('⭐ onCardMove travels the PROP and NOT the schema bag (objectui#9342)', async () => {
    // Both channels on ONE render, so the contrast is about the channel and not
    // about how each was authored. The prop is the firing control for the
    // schema-bag reading: without it, "the schema key did nothing" would also
    // be produced by a forward block that stopped forwarding anything.
    const onSchemaBag = vi.fn();
    const onProp = vi.fn();
    const before = recorded.impl.length;
    const { unmount } = render(
      <SchemaRendererProvider dataSource={undefined}>
        <KanbanRenderer
          schema={{ type: 'object-kanban', columns: STATIC_COLUMNS, onCardMove: onSchemaBag } as never}
          onCardMove={onProp}
        />
      </SchemaRendererProvider>,
    );
    const props = await lastBoardProps('impl', before, unmount);
    expect({
      fromProp: props.onCardMove === onProp,
      fromSchemaBag: props.onCardMove === onSchemaBag,
    }).toEqual({ fromProp: true, fromSchemaBag: false });
  });

  it.each(['object-kanban'])(
    "`'%s'` (ObjectKanban) passes NO onQuickAdd and supplies its OWN onCardClick and onCardMove",
    async (type) => {
      // ⭐ objectui#11234 flipped the `onQuickAdd` reading from `true` (arrives
      // by identity) to absent. The two `'function'` readings beside it are the
      // lit control: the same render hands the board live handlers, so the
      // absence is about this key and not a board that received nothing.
      const spies = authored();
      const props = await boardPropsFor(type, 'impl', spies);
      expect({
        onQuickAdd: props.onQuickAdd,
        quickAdd: props.quickAdd,
        onCardClick: props.onCardClick === spies.onCardClick,
        onCardMove: props.onCardMove === spies.onCardMove,
        onCardClickType: typeof props.onCardClick,
        onCardMoveType: typeof props.onCardMove,
      }).toEqual({
        onQuickAdd: undefined,
        quickAdd: undefined,
        onCardClick: false,
        onCardMove: false,
        onCardClickType: 'function',
        onCardMoveType: 'function',
      });
    },
  );

  it('the three RETIRED registrations resolve to nothing, and the survivor still does', () => {
    // Replaces the `'kanban-enhanced'` reachability leg, whose subject retired
    // (objectui#8257). Stated as a reading with its own firing control rather
    // than as three bare `false`s.
    expect({
      kanban: ComponentRegistry.has('kanban'),
      kanbanUi: ComponentRegistry.has('kanban-ui'),
      kanbanEnhanced: ComponentRegistry.has('kanban-enhanced'),
      objectKanban: ComponentRegistry.has('object-kanban'),
    }).toEqual({ kanban: false, kanbanUi: false, kanbanEnhanced: false, objectKanban: true });
  });
});

describe("ObjectKanban's own onCardClick wrapper CALLS the authored handler (objectui#7664)", () => {
  it("on the `'object-kanban'` key, an onCardClick authored on the DOCUMENT is run by the wrapper", async () => {
    const onCardClick = vi.fn();
    const card = { id: '1', title: 'One' };
    const props = await boardPropsViaSchemaRenderer({
      type: 'object-kanban',
      columns: STATIC_COLUMNS,
      onCardClick,
    });

    // Control: the board did NOT get the authored function itself — the
    // wrapper is genuinely interposed, so a call reaching the spy can only
    // have arrived through it.
    expect(props.onCardClick).not.toBe(onCardClick);
    (props.onCardClick as (c: unknown, e?: unknown) => void)(card);
    // ⭐ objectui#9341 — this leg's SUBJECT is unchanged (the wrapper still
    // runs the authored handler), but the call it runs it through moved. Two
    // calls used to reach the spy; `toHaveBeenCalledWith(card)` matched the
    // one-argument one, which is the call that card deleted as the poorer of
    // the pair. The survivor is `useNavigationOverlay`'s
    // `onRowClick(record, event)`, which carries the modifier payload. Read as
    // the whole call list so the count is part of the reading.
    expect(onCardClick.mock.calls).toEqual([[card, undefined]]);
  });
});

describe('the handler keys KanbanRenderer forwards, and where they are declared (objectui#7664)', () => {
  const INDEX_TSX = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.tsx');
  const CORE_TSX = join(dirname(fileURLToPath(import.meta.url)), '..', 'KanbanBoardCore.tsx');

  /** The `schema.on*` reads between two markers of one source file.
   *  ⚠️ `schema.`-anchored ON PURPOSE: this measures the DOCUMENT read path, so
   *  a handler that arrives as an explicit React prop (`onCardMove` since
   *  objectui#9342, the Quick Add pair on `KanbanBoardCore` since
   *  objectui#11234) is correctly absent rather than missed. */
  function documentReads(file: string, startMarker: string, endMarker: string | null): string[] {
    const src = readFileSync(file, 'utf8');
    const start = src.indexOf(startMarker);
    const end = endMarker === null ? src.length : src.indexOf(endMarker, start);
    // The `it`s below are this extraction's own anti-vacuity control: a marker
    // that stopped matching would make an index -1 and throw, and a marker that
    // matched too early would drop keys from the measured set.
    if (start === -1 || end === -1) throw new Error(`component body not found in ${file}`);
    return [...src.slice(start, end).matchAll(/schema\.(on[A-Z][A-Za-z0-9]*)\b/g)]
      .map((m) => m[1])
      .sort();
  }

  /** `KanbanRenderer`'s own body — it ends at the `kanban-ui` retirement tombstone that follows it. */
  const forwardedByKanbanRenderer = () =>
    documentReads(INDEX_TSX, 'export const KanbanRenderer', '⛔ The `kanban-ui` node type key is RETIRED');
  /** The internal board's body — the last declaration in its module. */
  const readByBoardCore = () => documentReads(CORE_TSX, 'export const KanbanBoardCore', null);

  it('the read site is measured, not listed: KanbanRenderer reads exactly these two off the document', () => {
    // ⭐ THREE until objectui#9342 moved `onCardMove` onto an explicit React
    // prop. That shrink is the deliverable, not a drift: the gate of record
    // refuses a `'retired'` tombstone while a renderer still reads the key off
    // the document, so the read had to go before the arm could carry one.
    //
    // ⭐ SPLIT across two bodies by objectui#11234. `KanbanRenderer` still reads
    // the same two keys, but `onCardClick` is now read by the internal board it
    // renders, with the document handed through `schema={schema}`, and
    // `onQuickAdd` stays in its own body as the host's half of the Quick Add
    // pair. Their union is this leg's old reading, so no key left the component.
    expect({ own: forwardedByKanbanRenderer(), board: readByBoardCore() }).toEqual({
      own: ['onQuickAdd'],
      board: ['onCardClick'],
    });
    const src = readFileSync(INDEX_TSX, 'utf8');
    expect(src, 'KanbanRenderer no longer hands its document to the internal board').toMatch(
      /<KanbanBoardCore\s+schema=\{schema\}/,
    );
  });

  it('⭐ the internal board stays internal: the barrel publishes `KanbanRenderer` and NOT `KanbanBoardCore` (objectui#11234)', async () => {
    // Only `KanbanRenderer` may carry the Quick Add pair to a host. An exported
    // `KanbanBoardCore` would be a second public board with its own copy of the
    // pair, so the barrel is read, with the published component as the control.
    const barrel = (await import('../index')) as Record<string, unknown>;
    expect({
      kanbanRenderer: typeof barrel.KanbanRenderer,
      kanbanBoardCore: 'KanbanBoardCore' in barrel,
    }).toEqual({ kanbanRenderer: 'function', kanbanBoardCore: false });
  });

  it('⭐ the `object-kanban` path reads only the internal board\'s keys — and those are all runtime slots (objectui#11234)', () => {
    // The board `ObjectKanban` renders is the one the registration reaches, so
    // ITS reads are what the `object-kanban` arm must declare callable. The
    // Quick Add pair is not among them, which is what let the arm tombstone
    // `onQuickAdd`.
    const shape = ObjectKanbanZod.shape as Record<string, { description?: string } | undefined>;
    expect(
      readByBoardCore().map((key) => ({ key, slot: shape[key]?.description?.includes('RUNTIME SLOT') ?? false })),
    ).toEqual([{ key: 'onCardClick', slot: true }]);
  });

  it('⭐ all three are declared on the surviving `object-kanban` face — measured per key, not per prefix', () => {
    // ⭐ This leg USED to assert `declared: true, guidance: true` against the
    // zod `'kanban'` arm, which carried all three as objectui#6124 RUNTIME
    // SLOTS; objectui#8802 retired that arm and the reading flipped to three
    // `false`s on the surviving `ObjectKanbanSchema`. objectui#7804 then ruled
    // the class (director seat, decision batch #69) and measured this face key
    // by key — and the answers DIFFER, which is why the expectation below is
    // spelled per key rather than mapped over the list:
    //   - `onCardClick` and `onQuickAdd` are objectui#6124 RUNTIME SLOTS. Suite
    //     1 above is where the two channels that make them so are measured —
    //     identity through the schema spread for the second, and the React prop
    //     the wrapper calls (suite 2) for the first.
    //   - `onCardMove` was declared by NOTHING and is no longer read off the
    //     document at all. Its authored value reaches neither channel, which is
    //     the `'retired'` disposition; `check:handler-key-reads` refused that
    //     spelling while this very forward block read the key, so objectui#9342
    //     moved the read to an explicit React prop and the arm now carries the
    //     tombstone. The third assertion below reads it off the mirror.
    //   - ⭐ `onQuickAdd` followed it (objectui#11234). It was a runtime slot
    //     that reached the board by identity and, on `object-kanban`, was never
    //     called, since its partner `quickAdd` is retired there. Its read now
    //     sits in `KanbanRenderer`'s body only, as the host's half of the pair,
    //     and no registration reaches that body. So the face tombstones it, and
    //     the leg above reads the `object-kanban` path's reads from the internal
    //     board instead.
    const shape = ObjectKanbanZod.shape as Record<string, { description?: string } | undefined>;
    const said = (key: string) => ({
      key,
      declared: key in shape,
      disposition: shape[key]?.description?.includes('RUNTIME SLOT')
        ? 'runtime-slot'
        : shape[key]?.description?.includes('RETIRED')
          ? 'retired'
          : 'neither',
    });
    const forwarded = [...new Set([...readByBoardCore(), ...forwardedByKanbanRenderer()])].sort();
    expect(forwarded.map(said)).toEqual([
      { key: 'onCardClick', declared: true, disposition: 'runtime-slot' },
      { key: 'onQuickAdd', declared: true, disposition: 'retired' },
    ]);
    // The key that LEFT the forward block is declared all the same — as a
    // tombstone, which is the whole point of moving the read (objectui#9342).
    expect(said('onCardMove')).toEqual({ key: 'onCardMove', declared: true, disposition: 'retired' });
    // Firing control on the SAME instrument: a key this face really does
    // declare reads `true`, so the three `false`s above are readings and not a
    // shape lookup that answers `false` to everything (an unwrapped
    // `.superRefine()` result, say, whose `.shape` is undefined).
    expect('groupBy' in shape).toBe(true);
  });
});

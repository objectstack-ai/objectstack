/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * All three handler keys the kanban board consumes are now JUDGED by the
 * `object-kanban` arm, and each one's objectui#6124 disposition is MEASURED
 * here rather than shared across the prefix (objectui#7804, the `plugin-kanban`
 * slice of the `KNOWN_UNDECLARED_READS` finding — ⛔ its row count is NOT
 * written down here. This file reads that ledger live, through the import
 * below, and `node scripts/check-handler-key-read-sites.mjs` prints the count
 * while its `--list` enumerates the rows. AGENTS.md #9: the figure this line
 * used to hard-code has since been overtaken by the population it described;
 * director seat ruling of 2026-09-07, decision batch #69 — with the third key
 * landing on objectui#9342, which moved the READ that had blocked its
 * tombstone).
 *
 * ## The exposure this closes
 *
 * `BaseSchema` is `.passthrough()`. A key an arm does not declare is not
 * refused — it stops being judged and the value is KEPT, then reaches the
 * renderer that reads it. `ObjectKanbanSchema` declared none of these three
 * while `KanbanRenderer` forwarded all three off `schema.*`, so an authored
 * `onCardClick: { action: 'toast' }` parsed GREEN and was handed to a call site
 * expecting a function. That is objectui#7664's measured transition, one arm
 * over, and `AlertDialogSchema.onAction` was this same shape until
 * objectui#7104 declared it.
 *
 * ## ⭐ The three do NOT agree, and that is the deliverable
 *
 * The ruling requires the disposition per key. Measured on the ONE surviving
 * registration, `'object-kanban'` (`ObjectKanbanRenderer` → `ObjectKanban` →
 * `KanbanRenderer`):
 *
 *   - `onQuickAdd` — RUNTIME SLOT when measured here: it rode `ObjectKanban`'s
 *     `...schema` spread untouched and arrived at the board implementation BY
 *     IDENTITY. ⭐ RETIRED since objectui#11234 — see the section at the end
 *     of this block.
 *   - `onCardClick` — RUNTIME SLOT. `ObjectKanban` replaces the schema key with
 *     its own wrapper, but `SchemaRenderer` also spreads the authored key as a
 *     React PROP, `ObjectKanbanComponentProps` declares that prop, and
 *     `ObjectKanban` forwards it into `useNavigationOverlay` as `onRowClick`,
 *     where `handleClick` gives it full priority and calls it. The authored
 *     function runs. (Until objectui#9341 the wrapper ALSO called it directly,
 *     which is why it ran twice — see the correction at the end of this block.)
 *   - `onCardMove` — the reading is `'retired'`, and since objectui#9342 it
 *     lands here as a TOMBSTONE on both faces. `ObjectKanban` replaces the
 *     schema key with `handleCardMove` and declares NO `onCardMove` prop (its
 *     rest parameter is discarded), so neither channel delivers and an authored
 *     value reaches nothing on this arm.
 *
 * ⛔ "`ObjectKanban` overrides it" does not separate `onCardClick` from
 * `onCardMove` — it is true of both. What separates them is the PROP channel,
 * which only `onCardClick` has, so that is what suite 2 drives.
 *
 * ## ⭐ Why the third key took a second card — and what closed it
 *
 * `check:handler-key-reads` — the gate of record for this class — refuses the
 * `'retired'` spelling while a renderer still reads the key, and prints
 * `declares it RETIRED, but a renderer still reads it`. Its own contract says
 * why: a tombstone "exists precisely because nothing reads the key — it has no
 * read site BY CONSTRUCTION". `KanbanRenderer` DID read the key off the
 * document `ObjectKanban` hands it; what the gate cannot see is that the value
 * at that read was substituted one hop earlier.
 *
 * ⛔ Of the two spellings that would have made it green, one is forbidden:
 * declaring `'runtime-slot'` keeps the TypeScript twin callable and so
 * publishes a key the object-bound board DROPS — the resolution this package's
 * `quickAdd` carve-out records as forbidden.
 *
 * ⇒ objectui#9342 took the other one, as a RULING rather than a repair (the
 * `domain:ui` seat on PR objectui#9338, option B; the objectui#7742 remedy
 * `objectFields` took one file over under maintainer decision batch #70):
 * `KanbanRenderer` now takes `onCardMove` as an explicit React PROP, a sibling
 * of `schema`, `ObjectKanban` passes `handleCardMove` through it, and the arm
 * carries `handlerKeyRefusal(…, 'retired', …)`. That narrows a published props
 * surface, which is why the change carries `needs:contract-review`.
 *
 * ⚠️ The DISPOSITION did not move. objectui#7804 measured `'retired'` and suite
 * 2 below still drives it dead on the same instrument; what objectui#9342
 * supplied is the precondition the gate demanded. Suite 1 used to pin the key
 * as STILL ACCEPTED AND KEPT, with the note that the day the read moved THAT
 * leg would go red — it did, and it now reads the named refusal instead.
 *
 * ## Every control here can fire
 *
 * A `'retired'` ruling is a claim about absence, and an absent read and an
 * unreachable one look identical to a grep. So the dead-read leg does not stop
 * at "the authored function is not the one the board got": it DRIVES the
 * handler the board was handed and asserts the authored spy never runs, with
 * the same drive on `onCardClick` — which does run it — as the lit control on
 * the same instrument, the same document and the same render.
 *
 * ## Predictions, written before the code (red-first)
 *
 * On the unmodified base tree (`origin/main` @ `0f3d15314`), with this file in
 * place and no `packages/types` change yet:
 *
 *   - suite 1 (the accept set) FAILS on the two declared keys: both parse
 *     GREEN and the authored value survives into the parsed output, which is
 *     the exposure restated as a reading. Its `onCardMove` leg PASSED before
 *     and after — that key was the one this slice did not close, and
 *     objectui#9342 flipped that leg to the named refusal;
 *   - suite 3 (both faces) FAILS on the two: nothing is declared on either
 *     face, so there is no disposition to read;
 *   - suite 4 (the drained ledger) FAILS listing the two
 *     `object-kanban::ObjectKanbanSchema.*` rows this slice drains, while its
 *     `onCardMove` row is expected to survive (⭐ objectui#9342 drained that
 *     third row too, and this suite now asserts the set is EMPTY);
 *   - suite 2 (the channels) PASSES UNCHANGED, before and after. It measures
 *     the renderer, and this card changes no renderer — which is exactly why it
 *     is the evidence the dispositions are derived from rather than a
 *     restatement of them.
 *
 * ⭐ The base run FALSIFIED the last of those, and the correction is recorded
 * rather than smoothed over: suite 1 and suites 3–4 failed exactly as written
 * (all three keys ACCEPTED, with the authored value surviving into the parsed
 * output), but the dead-read leg of suite 2 also failed — on its lit CONTROL,
 * not on its subject. `onCardMove` was already measured dead; `onCardClick` ran
 * TWICE rather than once. That count is a defect in `ObjectKanban`'s click
 * wiring, not in this card's subject, so the control asserted that the authored
 * handler RAN and the count was reported on its own card instead of being
 * pinned here.
 *
 * ⭐ THAT CARD LANDED (objectui#9341, maintainer ruling 2026-09-13): the
 * wrapper's second, one-argument call is gone, the authored handler runs ONCE
 * through `handleClick`, and the relaxed control here is TIGHTENED BACK to the
 * exact count in that same diff — the handoff this relaxation was written for.
 * Two readings in suite 2 and suite 3 moved with it, each for the same reason
 * and each noted at the assertion: the surviving call carries the modifier
 * event, so it is `(record, event)` rather than `(record)`, and the TypeScript
 * face declares the second parameter. The exact-count reading and the modifier
 * channel have their own file, `cardClickFiresOnce-9341.test.tsx`; what is
 * here stays the LIT CONTROL for the dead-read leg beside it.
 *
 * ## ⭐ What objectui#11234 moved: `onQuickAdd` is a tombstone now
 *
 * The runtime-slot reading above was TRUE and was also the defect. The function
 * arrived at the board by identity and, on `object-kanban`, was never called:
 * the control is gated on BOTH halves of the Quick Add pair, and objectui#8285
 * retired the other half, `quickAdd`, on this element. ruling B of decision
 * batch #91 keeps the pair with a React host only.
 *
 * The same gate that held `onCardMove` back held this one: it refuses a
 * tombstone while a renderer on the registration still reads the key off the
 * document, and `KanbanRenderer` did. `ObjectKanban` now renders the internal
 * `KanbanBoardCore`, which takes the pair only as explicit props, and supplies
 * neither half. So suite 2's `onQuickAdd` leg FLIPPED on purpose, from "arrives
 * by identity" to "reaches nothing", with `onCardClick` as the lit control on
 * the same render. Suite 3 reads `retired` and `never` for it on both faces.
 * The exported `KanbanRenderer` keeps the pair; that is measured in
 * `kanban-handler-slots-7664.test.tsx` and drawn in
 * `quickAddRetiredNotForwarded-8285.test.tsx`.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { ObjectKanbanSchema as ObjectKanbanZod } from '@object-ui/types/zod';
// The gate of record's own ledger, read rather than restated: suite 4 asks
// whether the rows this slice landed are gone and the one it did not is still
// there, and a copy of the list here could answer that about itself.
// @ts-expect-error — plain-JS shared gate, intentionally untyped (`allowJs: false`)
import { KNOWN_UNDECLARED_READS } from '../../../../scripts/check-handler-key-read-sites.mjs';
// Prose is not source. Without the mask a docblock naming a member spelling
// would be read as a declaration, and this file's TS-face leg would report a
// disposition nobody wrote (`scripts/js-comment-mask.mjs`, kept honest by
// `check:comment-mask-corpus`).
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';
import '../index';

/** Local annotations, since both imports above are untyped — the call sites stay checked. */
const mask: (source: string) => string = maskComments;
const ledger: Map<string, string> = KNOWN_UNDECLARED_READS;

/** The three keys this slice owns, in the ledger's own spelling. */
const KEYS = ['onCardClick', 'onCardMove', 'onQuickAdd'] as const;

/** The two objectui#7804 declared; `onCardMove` followed with objectui#9342, and its own leg below says so. */
const DECLARED = ['onCardClick', 'onQuickAdd'] as const;

/** Every props object the board implementation was rendered with, in order. */
const recorded = vi.hoisted(() => ({ impl: [] as Array<Record<string, unknown>> }));

// The lazy board chunk is a prop recorder: the question is what reaches the
// board's props, not what the board draws with them.
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
            quickAdd: true,
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

describe('suite 1 — the accept set: an authored handler key on `object-kanban` is REFUSED BY NAME (objectui#7804)', () => {
  /** The document shape objectui#7664 measured, re-pointed at the surviving key. */
  const board = (extra: Record<string, unknown>) => ({
    type: 'object-kanban',
    objectName: 'task',
    groupBy: 'status',
    ...extra,
  });

  it.each(DECLARED)('`%s: { action: "toast" }` draws the objectui#6124 named refusal', (key) => {
    const parsed = ObjectKanbanZod.safeParse(board({ [key]: { action: 'toast' } }));
    expect(
      {
        accepted: parsed.success,
        code: parsed.success ? null : parsed.error.issues[0]?.code,
        path: parsed.success ? null : parsed.error.issues[0]?.path.join('.'),
      },
      `an authored \`${key}\` still parses GREEN — the passthrough is keeping it and handing it to a call site that expects a function`,
    ).toEqual({ accepted: false, code: 'custom', path: key });
  });

  it('a live FUNCTION is refused there too — the arm is a refusal, not a type check', () => {
    // The #6124 predicate refuses everything, a function included: the JSON
    // face has no function value, and the programmatic face reaches the
    // renderer through React props and the TypeScript interface, never through
    // `safeParse`. Suite 2 is where the function channel is measured.
    const parsed = ObjectKanbanZod.safeParse(board({ onCardClick: () => {} }));
    expect(parsed.success).toBe(false);
  });

  it('⭐ `onCardMove` is REFUSED BY NAME — the row this slice could not close (objectui#9342)', () => {
    // ⭐ THE LEG THAT FLIPPED, and it flipped by design. It used to read
    // `{ accepted: true, kept: { action: 'toast' } }` — the objectui#7664
    // exposure restated as a reading, pinned so it could not drift in silence —
    // with the note that the day the read moved to an explicit React prop and
    // the key was tombstoned, THIS leg would go red. objectui#9342 is that day:
    // `KanbanRenderer` takes `onCardMove` as a React prop, so the arm carries
    // `handlerKeyRefusal(…, 'retired', …)` and the authored value is refused BY
    // NAME instead of being accepted and dropped.
    //
    // ⚠️ The DISPOSITION did not move — objectui#7804 measured it `'retired'`
    // and suite 2 below still drives it dead. Only the precondition the gate of
    // record demanded was supplied.
    const parsed = ObjectKanbanZod.safeParse(board({ onCardMove: { action: 'toast' } }));
    expect({
      accepted: parsed.success,
      code: parsed.success ? null : parsed.error.issues[0]?.code,
      path: parsed.success ? null : parsed.error.issues[0]?.path.join('.'),
      kept: parsed.success ? (parsed.data as Record<string, unknown>).onCardMove : null,
    }).toEqual({ accepted: false, code: 'custom', path: 'onCardMove', kept: null });
  });

  it('CONTROLS — the scope did not move: a declared key still parses, and an undeclared one is still KEPT', () => {
    // Lit control: the board itself is still acceptable, so the three `false`s
    // above are about those keys and not about a schema that now refuses
    // everything.
    expect(ObjectKanbanZod.safeParse(board({})).success).toBe(true);

    // Scope control: `BaseSchema` is still `.passthrough()`. This card judges
    // three keys; it does not turn the arm strict, and a reader must be able to
    // tell those apart.
    const probe = ObjectKanbanZod.safeParse(board({ zzzNotAHandlerKey: { action: 'toast' } }));
    expect({
      accepted: probe.success,
      kept: probe.success ? 'zzzNotAHandlerKey' in probe.data : null,
    }).toEqual({ accepted: true, kept: true });
  });
});

describe('suite 2 — the channels, per key, on the one surviving registration (objectui#7804)', () => {
  it('⭐ `onQuickAdd` reaches NOTHING, with `onCardClick` as the lit control on the same render (objectui#11234)', async () => {
    // ⭐ THE LEG THAT FLIPPED, by design. It read `props.onQuickAdd` BY
    // IDENTITY until objectui#11234: `KanbanRenderer` forwarded
    // `schema.onQuickAdd`, and `ObjectKanban` rendered `KanbanRenderer`.
    // `ObjectKanban` now renders the internal `KanbanBoardCore`, which takes the
    // Quick Add pair only as explicit props, and passes neither. `quickAdd: true`
    // is on this document too (see `boardPropsFor`), so the pair is authored
    // whole and neither half arrives.
    const onQuickAdd = vi.fn();
    const onCardClick = vi.fn();
    const card = { id: '1', title: 'One' };
    const props = await boardPropsFor({ onQuickAdd, onCardClick });
    (props.onCardClick as (c: unknown, e?: unknown) => void)(card);
    expect(
      {
        onQuickAdd: props.onQuickAdd,
        quickAdd: props.quickAdd,
        quickAddRan: onQuickAdd.mock.calls.length,
        cardClickRan: onCardClick.mock.calls.length,
      },
      'the lit control `onCardClick` must run — a board that received NOTHING would read the same absence',
    ).toEqual({ onQuickAdd: undefined, quickAdd: undefined, quickAddRan: 0, cardClickRan: 1 });
  });

  it('`onCardClick` is REPLACED by ObjectKanban, and the replacement CALLS the authored one', async () => {
    const onCardClick = vi.fn();
    const card = { id: '1', title: 'One' };
    const props = await boardPropsFor({ onCardClick });

    // Control: the wrapper is genuinely interposed, so a call that reaches the
    // spy can only have arrived through it.
    expect(props.onCardClick).not.toBe(onCardClick);
    (props.onCardClick as (c: unknown, e?: unknown) => void)(card);
    // ⭐ Reads the WHOLE call list, not one matching call (objectui#9341). The
    // old spelling was `toHaveBeenCalledWith(card)`, which passed on the base
    // tree because the SECOND, one-argument call matched it — the very call
    // that card deleted. What survives is `handleClick`'s
    // `onRowClick(record, event)`, so the authored handler is reached once and
    // with the event slot present. This is the channel, still measured, now
    // measured as it actually is.
    expect(onCardClick.mock.calls).toEqual([[card, undefined]]);
  });

  it('⭐ `onCardMove` reaches NOTHING — driven, not inferred, with `onCardClick` as the lit control', async () => {
    const onCardMove = vi.fn();
    const onCardClick = vi.fn();
    const card = { id: '1', title: 'One' };
    // ONE document, ONE render: the two keys travel the same passthrough, the
    // same `...schema` spread and the same prop spread, so the contrast below
    // is about the keys and not about how each was authored.
    const props = await boardPropsFor({ onCardMove, onCardClick });

    expect(props.onCardMove).not.toBe(onCardMove);
    // DRIVE the handler the board was actually handed. An authored value that
    // reached a live channel would run here; nothing does. A board with no
    // `groupBy` short-circuits `handleCardMove` before any write, so this drive
    // measures the forwarding and touches no data source.
    await (props.onCardMove as (a: string, b: string, c: string, d: number) => Promise<void> | void)(
      '1',
      'todo',
      'done',
      0,
    );
    (props.onCardClick as (c: unknown, e?: unknown) => void)(card);

    // ⭐ TIGHTENED BACK TO THE EXACT COUNT (objectui#9341, the card this control
    // was relaxed FOR). It read `cardClickRan: … > 0` while the base tree ran
    // the authored handler TWICE per click — `ObjectKanban` passed the same
    // function to `useNavigationOverlay` as `onRowClick`, whose `handleClick`
    // forwards to it and returns, and then called it again itself. That defect
    // is fixed in the same diff that restores this count, so the relaxation has
    // no subject any more; leaving it would let the double fire return in
    // silence. The exact count owns its own file
    // (`cardClickFiresOnce-9341.test.tsx`) — here it is still just the LIT
    // CONTROL for the dead-read reading beside it.
    expect(
      { cardMove: onCardMove.mock.calls.length, cardClick: onCardClick.mock.calls.length },
      'the lit control `onCardClick` must run — a run where NEITHER fires measures nothing',
    ).toEqual({ cardMove: 0, cardClick: 1 });
  });

  it("the prop channel is the difference: `ObjectKanbanComponentProps` declares `onCardClick`, and no `onCardMove` or `onQuickAdd`", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = mask(readFileSync(join(here, '..', 'ObjectKanban.tsx'), 'utf8'));
    const declares = (key: string) => new RegExp(`^\\s{2}${key}\\?:`, 'm').test(src);
    // `onQuickAdd` joined this reading with objectui#11234: with no prop to
    // arrive on and no schema read left on the path, it has neither channel.
    expect({
      onCardClick: declares('onCardClick'),
      onCardMove: declares('onCardMove'),
      onQuickAdd: declares('onQuickAdd'),
    }).toEqual({
      onCardClick: true,
      onCardMove: false,
      onQuickAdd: false,
    });
  });
});

describe('suite 3 — the disposition is legible on BOTH faces, and they agree (objectui#7804)', () => {
  const TS_FACE = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'types',
    'src',
    'objectql.ts',
  );

  /** The `ObjectKanbanSchema` interface body, comments masked. */
  function objectKanbanInterface(): string {
    const src = mask(readFileSync(TS_FACE, 'utf8'));
    const start = src.indexOf('export interface ObjectKanbanSchema');
    expect(start, '`ObjectKanbanSchema` not found on the TypeScript face').toBeGreaterThan(-1);
    const end = src.indexOf('\n}', start);
    expect(end, '`ObjectKanbanSchema` has no closing brace').toBeGreaterThan(start);
    return src.slice(start, end);
  }

  it('the zod mirror refuses all three by name — the third as a tombstone (objectui#9342)', () => {
    const shape = ObjectKanbanZod.shape as Record<string, { description?: string } | undefined>;
    expect(KEYS.map((key) => ({ key, declared: key in shape }))).toEqual([
      { key: 'onCardClick', declared: true },
      { key: 'onCardMove', declared: true },
      { key: 'onQuickAdd', declared: true },
    ]);
    for (const key of KEYS) {
      expect(shape[key]?.description, `\`${key}\` carries no author-facing guidance`).toContain(
        'objectui#6124',
      );
      expect(shape[key]?.description).toContain(key);
    }
  });

  it('the mirror spells RUNTIME SLOT on the live slot and RETIRED on the other two', () => {
    const shape = ObjectKanbanZod.shape as Record<string, { description?: string } | undefined>;
    const said = (key: string) =>
      shape[key]?.description?.includes('RUNTIME SLOT')
        ? 'runtime-slot'
        : shape[key]?.description?.includes('RETIRED')
          ? 'retired'
          : 'undeclared';
    expect({
      onCardClick: said('onCardClick'),
      onCardMove: said('onCardMove'),
      onQuickAdd: said('onQuickAdd'),
    }).toEqual({
      onCardClick: 'runtime-slot',
      // ⭐ objectui#9342. `'undefined'` here until the read moved; the reading
      // itself is objectui#7804's, and `said()` is the same reader for all
      // three, so this is the one that changed and not the instrument.
      onCardMove: 'retired',
      // ⭐ objectui#11234. `'runtime-slot'` until the object-kanban path's read
      // moved onto `KanbanBoardCore`'s explicit props; same reader as above.
      onQuickAdd: 'retired',
    });
  });

  it('the TypeScript twin keeps the live slot callable and tombstones the other two', () => {
    const body = objectKanbanInterface();
    const member = (key: string) => new RegExp(`^\\s{2}${key}\\?:\\s*([^;]+);`, 'm').exec(body)?.[1]?.trim();
    expect({
      onCardClick: member('onCardClick'),
      onCardMove: member('onCardMove'),
      onQuickAdd: member('onQuickAdd'),
    }).toEqual({
      // ⚠️ Two parameters since objectui#9341: the call that survives the
      // double-fire repair is `handleClick`'s `onRowClick(record, event)`, and
      // the one-argument spelling this pin used to read described only the
      // deleted call. A signature pin read off disk, so it moves WITH the
      // declaration and cannot drift from it.
      onCardClick: '(card: any, event?: any) => void',
      // ⭐ objectui#9342 — the `?: never` tombstone the measurement always
      // asked for. It read `undefined` (no member at all) while the gate of
      // record refused the spelling; moving `KanbanRenderer`'s read to an
      // explicit React prop is what made it writable. ⛔ `never`, NOT a
      // callable: a callable twin publishes a key the object-bound board
      // DROPS, which is the `quickAdd` carve-out's forbidden resolution.
      onCardMove: 'never',
      // ⭐ objectui#11234 — the same tombstone, for the same reason: a callable
      // twin publishes a key the object-bound board never calls.
      onQuickAdd: 'never',
    });

    // Firing control on the same reader: a member this interface has always
    // declared still reads, so the three readings above are not a regex that
    // matches nothing.
    expect(member('groupBy')).toBe('string');
  });
});

describe('suite 4 — the ledger drained with the fix (objectui#7804)', () => {
  it('every `object-kanban` row is drained — the last one by objectui#9342', () => {
    const rows = [...ledger.keys()].filter((row) =>
      row.startsWith('object-kanban::'),
    );
    expect(
      rows,
      'a ledger row naming a read that is now declared is a live waiver for a defect that is gone — ' +
        '`staleExemptions()` in the gate reddens on exactly that',
    ).toEqual([]);
  });

  it('CONTROL — the ledger still carries the rows this slice did NOT take', () => {
    // objectui#7804 stays the parent and lands per package. A drained ledger
    // would mean this leg is reading an empty map rather than a shrinking one.
    //
    // ⚠️ The WITNESS is re-derived, not decorative. This leg named
    // `detail::DetailSchema.onNavigate` until the `plugin-detail` slice of the
    // same card declared it and drained the row — a row this slice did not
    // take, taken by a sibling slice that landed after it. That is the shape
    // to expect here: the witness is only ever a row no LANDED slice has
    // closed yet, so when its own slice lands, re-derive it against
    // `KNOWN_UNDECLARED_READS` rather than dropping the name and leaving the
    // length check alone — the length alone passes on a map holding one stale
    // row, which is the reading this control exists to refuse.
    //
    // ⚠️ Re-derived a second time by objectui#9573, and that one did NOT land a
    // slice: it re-keyed the census on what a registration CLAIMS, so the
    // thirteen alias-shape rows — `button::ButtonSchema.onSuccess` among them,
    // which this leg named until then — left the ledger because they were never
    // those components' rows. `{ namespace: 'action', skipFallback: true }`
    // means the registration never claims the bare `button` key, so
    // `ButtonSchema` was another component's arm. ⇒ the witness is now the one
    // row that is NOT alias-shape.
    const remaining = [...ledger.keys()];
    expect(remaining.length).toBeGreaterThan(0);
    expect(remaining).toContain('detail::DetailSchema.onTabChange');
  });
});

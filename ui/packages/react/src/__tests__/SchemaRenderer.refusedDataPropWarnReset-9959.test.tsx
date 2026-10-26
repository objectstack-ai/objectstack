/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9959 — the refused-`data` dev warning's dedupe `Set` is resettable,
 * and the suite actually reaches the reset.
 *
 * ## The defect this pins, and why an ordinary test would not see it
 *
 * The warning (objectui#9571, alias leg objectui#9758) is emitted once per
 * distinct `type#id`, out of module state. A dedupe that nothing clears makes
 * the FIRST test in a file the only one that reads the renderer: every later
 * block asking about the same node reads the first block's dedupe entry and
 * sees silence. `propsBagDiagnostic.ts` states that failure in its own reset's
 * docblock — "a green run that checked nothing" — and this diagnostic was the
 * one in this package without the affordance.
 *
 * The dangerous direction is the ABSENCE assertion: a later block asserting the
 * warning did NOT fire for an already-warned `type#id` is green on the defect
 * and green on the fix alike, and it reports that green as coverage. Rows 2 and
 * 3 below are therefore the file's whole point — ⛔ NOT row 1, and ⛔ not a call
 * to the reset function, which would prove only that a symbol exists.
 *
 * ## The construction
 *
 * ONE `type#id` across three `it()` blocks, with the reset in `beforeEach`:
 *
 *   row 1  authored `data` on the object arm            -> the warning fires
 *   row 2  the SAME `type#id`, next block               -> it fires AGAIN
 *   row 3  the SAME `type#id`, rows handed down by a
 *          HOST instead of authored                     -> silence, next to a
 *                                                          live-channel control
 *
 * Row 2 is the leg that is red without a clearing reset. Row 3 is the shape the
 * card names: its silence means something only because the control at the end
 * of the same block proves the channel could still speak — without the reset
 * that control is suppressed too, so row 3 goes red rather than quietly
 * passing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import { __resetRefusedDataPropWarnings } from '../utils/refusedDataPropDiagnostic';

/** A block on the `ViewData` OBJECT arm — the arm whose authored `data` is refused. */
const TYPE = 'object-map';
/**
 * ONE id for every row. That is the variable under test: the dedupe key is
 * `type#id`, so re-using it is what makes a later block depend on the reset.
 */
const ID = 'shared-9959';

/** Rows an author put in the metadata. */
const AUTHORED = [{ id: 'a1', name: 'Authored row' }];
/** Rows a HOST pre-fetched and handed down — the carrier the ruling protects. */
const HOSTED = [{ id: 'h1', name: 'Host row' }];

/** The sentence the diagnostic emits, matched the way its existing pins match it. */
const REFUSED = 'NOT passed to the component';

/**
 * The last props bag `SchemaRenderer` handed the component. A container whose
 * PROPERTY is written, not an outer `let` reassigned: `react-hooks/globals`
 * refuses the reassignment form during render.
 */
const captured: { props: Record<string, unknown> | null } = { props: null };

const Probe = (props: Record<string, unknown>) => {
  captured.props = props;
  return <div data-testid="probe" />;
};

/** Render one node and hand back the exact bag the component received. */
function seenFor(
  schema: object,
  hostProps: Record<string, unknown> = {},
): Record<string, unknown> {
  captured.props = null;
  render(<SchemaRenderer schema={schema as never} {...hostProps} />);
  if (captured.props === null) throw new Error('probe never rendered — check the registry key');
  return captured.props;
}

/**
 * The spy, made through a factory so its type is INFERRED. A bare
 * `ReturnType<typeof vi.spyOn>` annotation resolves the generic overload to its
 * unparameterised form and hands back `any` calls — `tsc -p tsconfig.test.json`
 * refuses it, and it would have made every assertion below unchecked.
 */
const spyOnWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
let warn: ReturnType<typeof spyOnWarn>;

/** Only the refusal lines, so an unrelated dev warning cannot stand in for one. */
const refused = (): string[] =>
  warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(REFUSED));

describe('SchemaRenderer — the refused-`data` warning survives into a second test (objectui#9959)', () => {
  beforeEach(() => {
    captured.props = null;
    ComponentRegistry.register(TYPE, Probe as never);
    // The affordance under test. Without it, every row after the first reads
    // row 1's dedupe entry instead of the renderer.
    __resetRefusedDataPropWarnings();
    warn = spyOnWarn();
  });

  afterEach(() => {
    ComponentRegistry.unregister?.(TYPE);
    cleanup();
    vi.restoreAllMocks();
  });

  it('1. the warning fires for the subject node — the entry this file then re-uses', () => {
    const seen = seenFor({ type: TYPE, id: ID, data: AUTHORED });

    // The strip really ran: the authored key lost the prop seat.
    expect('data' in seen).toBe(false);

    const messages = refused();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(`id="${ID}"`);
  });

  it('2. …and it fires AGAIN, for the SAME `type#id`, in a separate `it()` — the leg the reset carries', () => {
    // ⛔ Without a reset that clears, row 1 already owns `TYPE#ID` and this
    // render is deduped into silence. Red here is the defect, not a flake.
    const seen = seenFor({ type: TYPE, id: ID, data: AUTHORED });

    expect('data' in seen).toBe(false);
    expect(
      refused(),
      'objectui#9959: the refused-`data` dedupe was not cleared between tests, so this ' +
        'block read the previous one\'s entry instead of the renderer. Every later ' +
        'assertion about this warning — above all an ABSENCE one — is then green ' +
        'whatever the renderer does.',
    ).toHaveLength(1);
  });

  it('3. the ABSENCE reading is a real reading: HOST rows on the same `type#id`, beside a live-channel control', () => {
    // The card's own shape. `...props` is spread LAST and is never routed
    // through the strip (Option B was REFUSED on objectui#9571), so a node that
    // authored no `data` key has nothing refused and must draw silence.
    const seen = seenFor({ type: TYPE, id: ID }, { data: HOSTED });

    expect(seen.data).toEqual(HOSTED);
    expect(refused()).toEqual([]);

    // ⭐ The control that makes the silence above mean something: the SAME
    // `type#id`, authored this time. If the dedupe were still holding row 1's
    // and row 2's entry, this would be silent too — and then the assertion
    // above would have been reading the dedupe, not the renderer.
    const authored = seenFor({ type: TYPE, id: ID, data: AUTHORED });

    expect('data' in authored).toBe(false);
    expect(
      refused(),
      'objectui#9959: the channel was mute for the AUTHORED node as well, so the ' +
        'absence asserted above proves nothing about the renderer.',
    ).toHaveLength(1);
  });
});

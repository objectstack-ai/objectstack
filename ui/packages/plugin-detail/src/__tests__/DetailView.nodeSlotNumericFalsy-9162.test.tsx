/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:detail`'s two authored node slots — `header` and `footer` — refuse a
 * numeric-falsy authored value instead of painting it into the DOM
 * (objectui#9162).
 *
 * ## Why this file exists separately from the components one
 *
 * objectui#9162's own probe measured eleven leaking sites in
 * `@object-ui/components`. These two were **census hits, not measurements** —
 * the card's TypeScript census reported them and said so, and the triage
 * ruling made "probe before you change it, and report the reading either way"
 * an acceptance condition. This file is that probe, kept as the pin.
 *
 * **Measured on `origin/main` at `7d6439c4b`, before the repair: both LEAK.**
 * `header: 0` and `footer: 0` each painted the character `0` into the detail
 * surface. So they are the same defect as the eleven, not merely the same
 * shape, and they were repaired with the same guard.
 *
 * ## The instrument
 *
 * `document.body.textContent`, compared against the baseline the same harness
 * produces with the slot omitted. Each slot carries its own LIT CONTROL — the
 * same slot fed `42` must reach the text — so a row cannot go green because
 * the surface stopped rendering. A leak row whose lit control does not fire is
 * NOT MEASURED, ⛔ not clean.
 *
 * ## ⛔ Not a licence to narrow the declaration
 *
 * objectui#7105: node slots relax the RENDERER. `anAuthoredNodeStillRenders`
 * is the live control that the repair did not turn these into objects-only or
 * primitives-only slots.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { DetailView } from '../DetailView';
import type { DetailViewSchema, SchemaNode } from '@object-ui/types';

afterEach(() => cleanup());

/** A sentinel distinct from every authorable value, including `undefined`. */
const OMIT = Symbol('omit');

/** Minimal record surface — enough that the view mounts its slots at all. */
const BASE: DetailViewSchema = {
  type: 'detail-view',
  objectName: 'thing',
  title: 'Fixture',
  data: { id: 'X1', qty: 3 },
  fields: [{ name: 'qty', label: 'Qty' }],
};

function renderSlot(slot: 'header' | 'footer', value: unknown): string {
  // Typed as the view, and the value written through the slot's own type: both
  // slots are `SchemaNode`, which admits the primitives this file feeds them.
  const schema: DetailViewSchema = { ...BASE };
  if (value !== OMIT) schema[slot] = value as SchemaNode;
  render(<DetailView schema={schema} />);
  return document.body.textContent ?? '';
}

describe.each(['header', 'footer'] as const)(
  'record:detail %s — numeric-falsy node slot (objectui#9162)',
  (slot) => {
    it('LIT CONTROL — the instrument sees this slot: 42 reaches the text', () => {
      // Green in BOTH worlds by design: without it, a slot that stopped
      // rendering entirely would make the leak rows below green while
      // measuring nothing.
      const baseline = renderSlot(slot, OMIT);
      cleanup();
      const lit = renderSlot(slot, 42);
      expect(lit).not.toBe(baseline);
      expect(lit).toContain('42');
    });

    it('0 does not leak', () => {
      // RED on `origin/main` at 7d6439c4b — this slot WAS leaking, the census
      // hit was a real defect.
      const baseline = renderSlot(slot, OMIT);
      cleanup();
      expect(renderSlot(slot, 0)).toBe(baseline);
    });

    it('-0 does not leak — React prints it as the single character "0"', () => {
      const baseline = renderSlot(slot, OMIT);
      cleanup();
      expect(renderSlot(slot, -0)).toBe(baseline);
    });

    it('NaN does not leak — three characters, not one', () => {
      const baseline = renderSlot(slot, OMIT);
      cleanup();
      const withNaN = renderSlot(slot, NaN);
      expect(withNaN).toBe(baseline);
      expect(withNaN).not.toContain('NaN');
    });

    it('anAuthoredNodeStillRenders — LIVE CONTROL: still a node slot', () => {
      expect(renderSlot(slot, { type: 'text', content: 'liveNode' })).toContain('liveNode');
    });

    it('anAuthoredStringStillRenders — LIVE CONTROL: primitives still admitted', () => {
      expect(renderSlot(slot, 'liveText')).toContain('liveText');
    });

    describe('rowsThatCannotDiscriminate — ⛔ green before the repair too', () => {
      it('false was ALREADY correct — React ignores `false` as a child', () => {
        const baseline = renderSlot(slot, OMIT);
        cleanup();
        expect(renderSlot(slot, false)).toBe(baseline);
      });

      it("'' was ALREADY correct — an empty string contributes no characters", () => {
        const baseline = renderSlot(slot, OMIT);
        cleanup();
        expect(renderSlot(slot, '')).toBe(baseline);
      });
    });
  },
);

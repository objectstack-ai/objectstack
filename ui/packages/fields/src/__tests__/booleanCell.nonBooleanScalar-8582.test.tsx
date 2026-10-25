/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8582 — `BooleanCellRenderer` read a non-boolean SCALAR by
 * truthiness, so the string `'false'` and `{}` drew a CHECKED checkbox.
 *
 * objectui#8490 (`2a38862f5`) ruled that a boolean column holding `[]` holds
 * NO value and deliberately left every other non-boolean input on the old
 * coercion. This is that untouched surface. Measured on `2a38862f5` by
 * rendering — the "before" column is what THE DEFECT legs of this file were
 * observed to fail on when run against that tree (failure modes per leg are
 * in the PR):
 *
 * | stored value             | rendered before                      | why                                        |
 * |--------------------------|--------------------------------------|--------------------------------------------|
 * | `'false'`, `'0'`, `{}`   | a CHECKED, disabled checkbox         | `!!value` of a non-empty string / an object |
 * | `'false'` on `completed` | the green "Completed" indicator      | `value ? … : …`                            |
 * | `'false'` on `active`    | a CHECKED checkbox and no "Off" badge | `!value` was false, so the badge skipped   |
 * | `0`, `''`                | an UNCHECKED checkbox                | falsy scalars                              |
 * | `0` on `active`          | the destructive "Active — Off" badge | `!0`                                       |
 *
 * ── The ruling is the spec's, not this file's ─────────────────────────────
 * `@objectstack/spec`'s runtime value contract for `boolean` / `toggle` is a
 * bare `z.boolean()` (`data/field-value.zod.ts`, `valueSchemaFor`). The same
 * module declares the class "a JS boolean on the wire (driver read-coercion
 * repairs SQL 0/1)" and lists it under `NON_TEXT_STORED_VALUE_TYPES`: a
 * boolean column's stored value "is never text on any backend". The truth
 * table that turns `'true'` / `1` / `'0'` into a boolean already lives at the
 * producer boundaries — objectql's `coerceBooleanFields` on the read path and
 * its `invalid_boolean` write-path refusal, `rest`'s `parseBooleanCell` on
 * CSV import — so a non-boolean that reaches this renderer is a producer that
 * skipped its repair, and a second copy of that table here would be the
 * renderer-side dialect AGENTS.md #0.1 forbids.
 *
 * Hence ONLY a real boolean is a value of a boolean column. Everything else —
 * the truthy strings, the falsy scalars, `{}`, the spellings an ingest
 * boundary would have accepted, and (since objectui#8490) `[]` — lands on the
 * shared `EmptyValue` affordance, whose accessible name "No value" is a
 * statement about the field's TYPE: the record holds no boolean here. `{}`
 * and `'false'` land there for the same reason, and neither is "checked" any
 * more. Declared, not smoothed: the affordance does not say WHICH wrong-typed
 * value the column holds; the platform's instrument for that is the
 * write-path refusal, not the read renderer.
 *
 * ── Why the POPULATED cases are the load-bearing ones ─────────────────────
 * The caricature is a renderer that draws a box only for a literal `true`
 * (`value !== true` in place of `typeof value !== 'boolean'`). It satisfies
 * every THE DEFECT case in this file. What refuses it is the POPULATED block:
 * a real `false` still draws an UNCHECKED box and its "Not completed"
 * indicator (and, until objectui#13412 retired it, its "Off" badge; an
 * `active`-named `false` is now that same unchecked box). Each was RUN
 * against the caricature, not predicted.
 *
 * ── Why each defect case asserts the artefact's ABSENCE first ─────────────
 * "a checked checkbox is a fabricated true" / "an unchecked checkbox is a
 * fabricated false" are the sentences that fail on the unfixed tree; "the
 * shared EmptyValue affordance must be present" is the one that fails on a
 * renderer that draws nothing at all. They are textually distinct so the legs
 * can be told apart by failure MODE rather than by count.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { getCellRenderer, resolveCellRendererType } from '../index';

afterEach(() => cleanup());

/** Resolve + render exactly the way a consumer builds a read-mode cell. */
function renderCell(type: string, value: unknown, field: Record<string, unknown> = {}) {
  const Renderer = getCellRenderer(resolveCellRendererType({ type }) || type);
  return render(
    <Renderer value={value as any} field={{ type, name: type, ...field } as any} />,
  );
}

const affordance = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('[data-slot="empty-value"]');
const checkbox = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('[role="checkbox"]');
const completionIndicator = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('[data-testid="completion-indicator"]');
const offBadge = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('[data-testid="boolean-warning-badge"]');

function expectAffordance(root: HTMLElement, label: string) {
  const empty = affordance(root);
  expect(empty, `${label}: the shared EmptyValue affordance must be present`).not.toBeNull();
  expect(
    empty?.getAttribute('aria-label'),
    `${label}: the affordance must carry its accessible name`,
  ).toBe('No value');
}

/** Non-booleans that are TRUTHY — the values the old renderer drew as a checked box. */
const FABRICATED_TRUE: ReadonlyArray<readonly [label: string, value: unknown]> = [
  ["the string 'false'", 'false'],
  ["the string '0'", '0'],
  ["the string 'no'", 'no'],
  ['an empty object {}', {}],
];

/** Non-booleans that are FALSY — the values the old renderer drew as an unchecked box. */
const FABRICATED_FALSE: ReadonlyArray<readonly [label: string, value: unknown]> = [
  ['the number 0', 0],
  ["the empty string ''", ''],
];

/**
 * Spellings the platform's INGEST boundaries accept and repair (objectql's
 * `coerceBooleanFields`, `rest`'s `parseBooleanCell`). On the wire they are
 * still not booleans, and this renderer owns no copy of that table.
 */
const INGEST_SPELLINGS: ReadonlyArray<readonly [label: string, value: unknown]> = [
  ["the string 'true'", 'true'],
  ["the string '1'", '1'],
  ['the number 1', 1],
];

describe('objectui#8582 — only a real boolean is a value of a boolean column', () => {
  describe('THE DEFECT — a truthy non-boolean drew a CHECKED box, an affirmative the record never gave', () => {
    for (const type of ['boolean', 'toggle'] as const) {
      for (const [label, value] of FABRICATED_TRUE) {
        it(`THE DEFECT — \`${type}\` holding ${label} draws no checkbox and the No-value affordance`, () => {
          const { container } = renderCell(type, value);
          expect(
            checkbox(container),
            `${type} holding ${label}: a checked checkbox is a fabricated true`,
          ).toBeNull();
          expectAffordance(container, `${type} holding ${label}`);
        });
      }
    }

    it("THE DEFECT — a COMPLETION-named boolean holding the string 'false' draws no \"Completed\" indicator", () => {
      const { container } = renderCell('boolean', 'false', { name: 'completed' });
      expect(
        completionIndicator(container),
        "completed holding 'false': a green Completed indicator is a fabricated true",
      ).toBeNull();
      expectAffordance(container, "completed holding 'false'");
    });

    it("THE DEFECT — an ACTIVE-named boolean holding the string 'false' draws neither a checkbox nor an \"Off\" badge", () => {
      const { container } = renderCell('boolean', 'false', { name: 'active' });
      expect(
        checkbox(container),
        "active holding 'false': a checked checkbox is a fabricated true",
      ).toBeNull();
      expect(
        offBadge(container),
        "active holding 'false': an Off badge is a fabricated false",
      ).toBeNull();
      expectAffordance(container, "active holding 'false'");
    });
  });

  describe('THE OTHER DIRECTION — a falsy non-boolean drew an UNCHECKED box, a false the record never stored', () => {
    for (const type of ['boolean', 'toggle'] as const) {
      for (const [label, value] of FABRICATED_FALSE) {
        it(`THE OTHER DIRECTION — \`${type}\` holding ${label} draws no checkbox and the No-value affordance`, () => {
          const { container } = renderCell(type, value);
          expect(
            checkbox(container),
            `${type} holding ${label}: an unchecked checkbox is a fabricated false`,
          ).toBeNull();
          expectAffordance(container, `${type} holding ${label}`);
        });
      }
    }

    it('THE OTHER DIRECTION — an ACTIVE-named boolean holding the number 0 draws no "Off" badge', () => {
      const { container } = renderCell('boolean', 0, { name: 'active' });
      expect(
        offBadge(container),
        'active holding 0: an Off badge is a fabricated false',
      ).toBeNull();
      expect(checkbox(container), 'active holding 0: a checkbox is a fabricated value').toBeNull();
      expectAffordance(container, 'active holding 0');
    });

    it("THE OTHER DIRECTION — a COMPLETION-named boolean holding the empty string '' draws no \"Not completed\" indicator", () => {
      const { container } = renderCell('boolean', '', { name: 'completed' });
      expect(
        completionIndicator(container),
        "completed holding '': a Not-completed indicator is a fabricated false",
      ).toBeNull();
      expectAffordance(container, "completed holding ''");
    });
  });

  describe('THE RULING — the renderer owns no truth table: an ingest spelling is still not a boolean on the wire', () => {
    for (const [label, value] of INGEST_SPELLINGS) {
      it(`THE RULING — \`boolean\` holding ${label} draws no checkbox and the No-value affordance`, () => {
        const { container } = renderCell('boolean', value);
        expect(
          checkbox(container),
          `boolean holding ${label}: the renderer owns no truth table, so a checkbox here is a coercion the spec assigns to the producer`,
        ).toBeNull();
        expectAffordance(container, `boolean holding ${label}`);
      });
    }
  });

  describe('POPULATED — a real boolean still draws exactly what it drew before (the load-bearing block)', () => {
    for (const type of ['boolean', 'toggle'] as const) {
      it(`POPULATED — \`${type}\` holding a real \`true\` is still a CHECKED checkbox`, () => {
        const { container } = renderCell(type, true);
        const box = checkbox(container);
        expect(box, `${type}: a real true must still draw its checkbox`).not.toBeNull();
        expect(box?.getAttribute('aria-checked'), `${type}: a real true must still be checked`).toBe('true');
        expect(affordance(container), `${type}: a real true must NOT render the affordance`).toBeNull();
      });

      it(`POPULATED — \`${type}\` holding a real \`false\` is still an UNCHECKED checkbox (false is a value, not an absence)`, () => {
        const { container } = renderCell(type, false);
        const box = checkbox(container);
        expect(box, `${type}: a real false must still draw its checkbox`).not.toBeNull();
        expect(box?.getAttribute('aria-checked'), `${type}: a real false must still be unchecked`).toBe('false');
        expect(affordance(container), `${type}: a real false must NOT render the affordance`).toBeNull();
      });
    }

    it('POPULATED — a COMPLETION-named boolean holding a real `true` still draws the "Completed" indicator', () => {
      const { container } = renderCell('boolean', true, { name: 'completed' });
      expect(
        completionIndicator(container)?.getAttribute('aria-label'),
        'completed: a real true must still draw its Completed indicator',
      ).toBe('Completed');
      expect(affordance(container), 'completed: a real true must NOT render the affordance').toBeNull();
    });

    it('POPULATED — a COMPLETION-named boolean holding a real `false` still draws the "Not completed" indicator', () => {
      const { container } = renderCell('boolean', false, { name: 'completed' });
      expect(
        completionIndicator(container)?.getAttribute('aria-label'),
        'completed: a real false must still draw its Not-completed indicator',
      ).toBe('Not completed');
      expect(affordance(container), 'completed: a real false must NOT render the affordance').toBeNull();
    });

    it('POPULATED — an ACTIVE-named boolean holding a real `false` is an UNCHECKED checkbox named by the field, not a badge (objectui#13412)', () => {
      const { container } = renderCell('boolean', false, { name: 'active', label: 'Active' });
      const box = checkbox(container);
      expect(box, 'active: a real false must still draw its checkbox').not.toBeNull();
      expect(box?.getAttribute('aria-checked'), 'active: a real false must still be unchecked').toBe('false');
      expect(box?.getAttribute('aria-label'), 'active: the box must still name the field').toBe('Active');
      expect(offBadge(container), 'active: a real false draws no Off badge').toBeNull();
      expect(affordance(container), 'active: a real false must NOT render the affordance').toBeNull();
    });

    it('POPULATED — an ACTIVE-named boolean holding a real `true` still draws a CHECKED checkbox and no badge', () => {
      const { container } = renderCell('boolean', true, { name: 'active' });
      expect(checkbox(container)?.getAttribute('aria-checked'), 'active: a real true must still be a checked box').toBe('true');
      expect(offBadge(container), 'active: a real true must draw no Off badge').toBeNull();
    });
  });

  describe('THE BOUNDARY — the objectui#8490 half is unchanged: [] and null are the same affordance', () => {
    it('THE BOUNDARY — `boolean` holding [] still draws the affordance and no checkbox (objectui#8490, unchanged)', () => {
      const { container } = renderCell('boolean', []);
      expect(checkbox(container), 'boolean holding []: a checkbox is a fabricated value').toBeNull();
      expectAffordance(container, 'boolean holding []');
    });

    it('THE BOUNDARY — `boolean` holding null / undefined still draws the affordance (the pre-existing branch, unchanged)', () => {
      for (const value of [null, undefined]) {
        const { container } = renderCell('boolean', value);
        expect(checkbox(container), `boolean holding ${String(value)}: a checkbox is a fabricated value`).toBeNull();
        expectAffordance(container, `boolean holding ${String(value)}`);
        cleanup();
      }
    });
  });
});

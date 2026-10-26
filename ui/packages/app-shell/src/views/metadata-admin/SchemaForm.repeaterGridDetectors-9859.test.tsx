// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9859 — a `RepeaterField` grid/table CELL resolves its widget through
 * the same chain a CARD row does.
 *
 * ## What was measured (baseline `a0176176a`, real `SchemaForm` render)
 *
 * The five name-convention detectors were called in exactly one place — inline
 * in `FieldRow`, behind `if (!fieldSpec?.widget)`. `RepeaterField`'s grid/table
 * layout does not go through `FieldRow`: a grid row has no `<label>`, so it
 * names each cell from its column header by IDREF instead (objectui#5063), and
 * it handed `FieldControl` the result of `inferWidget` alone. Every detector was
 * therefore skipped for every grid cell, so the same property in the same
 * repeater resolved to two different faces depending on one layout flag:
 *
 * ```
 * sub-field    detector                card layout      grid layout (before)
 * apiKey       detectSecretWidget      input[password]  input (plain text)
 * icon         detectIconWidget        icon picker      input (plain text)
 * color        detectColorWidget       input[color]     input (plain text)
 * visible      detectConditionWidget   condition group  input (plain text)
 * titleField   detectFieldRefWidget    field picker     input (plain text)
 * ```
 *
 * `detectSecretWidget` is the sharp end: a repeater that opts into
 * `widget: 'grid'` lost credential masking silently — no warning, no
 * diagnostic, nothing an author could see.
 *
 * ## What this file pins
 *
 *  1. each of the five detectors reaches a grid CELL — asserted through the
 *     face that renders, not through the widget name;
 *  2. the CARD layout of the very same spec resolves to the same face, in the
 *     same run — this is the asymmetry the card was about, and it is what makes
 *     each assertion a parity claim rather than a snapshot;
 *  3. a plain sub-field stays a plain text input under BOTH layouts, so the
 *     chain is shown to discriminate rather than to blanket-convert;
 *  4. the masked credential cell really is masked (`type="password"`), which is
 *     the only one of the five with a security consequence.
 *
 * ⚠️ The fix shape this pins is a SHARED path, not a patched branch: a second
 * copy of the detector chain inside the grid branch would make cases 1 and 2
 * green while leaving the sixth detector to be forgotten again.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { SchemaForm } from './SchemaForm';
import { loaded } from './loadState';
import type { WidgetContext } from './widgets';

afterEach(cleanup);

/** A catalog that LOADED — `detectFieldRefWidget` is gated on one being wired. */
const ctx: WidgetContext = {
  conditionScope: 'flattened',
  objectFields: loaded([
    { name: 'status', label: 'Status' },
    { name: 'owner', label: 'Owner' },
  ]),
};

interface DetectorCase {
  /** The detector under test, named so a failure says which one went missing. */
  detector: string;
  /** A sub-field name that trips it by convention. */
  sub: string;
  /** The sub-field's JSON Schema fragment. */
  schema: Record<string, unknown>;
  /** How the resolved face is recognised inside a container. */
  face: (root: ParentNode) => Element | null;
  /** What that face is, for the failure message. */
  faceName: string;
}

const CASES: DetectorCase[] = [
  {
    detector: 'detectFieldRefWidget',
    sub: 'titleField',
    schema: { type: 'string' },
    face: (root) => root.querySelector('[role="combobox"]'),
    faceName: 'the object-field picker',
  },
  {
    detector: 'detectSecretWidget',
    sub: 'apiKey',
    schema: { type: 'string' },
    face: (root) => root.querySelector('input[type="password"]'),
    faceName: 'the masked credential input',
  },
  {
    detector: 'detectIconWidget',
    sub: 'icon',
    schema: { type: 'string' },
    face: (root) => root.querySelector('[aria-haspopup="dialog"]'),
    faceName: 'the icon picker',
  },
  {
    detector: 'detectColorWidget',
    sub: 'color',
    schema: { type: 'string' },
    face: (root) => root.querySelector('input[type="color"]'),
    faceName: 'the colour input',
  },
  {
    detector: 'detectConditionWidget',
    sub: 'visible',
    schema: { type: 'string' },
    face: (root) => root.querySelector('[role="group"]'),
    faceName: 'the condition builder',
  },
];

/**
 * One repeater carrying the case's sub-field plus a plain `label` column. The
 * plain column is the same-render control: it must stay a text input under both
 * layouts, so a green case cannot be a chain that converts everything.
 */
function formFor(c: DetectorCase, layout: 'grid' | 'card') {
  return {
    type: 'simple',
    sections: [
      {
        label: 'S',
        fields: [
          {
            field: 'rows',
            type: 'repeater',
            ...(layout === 'grid' ? { widget: 'grid' } : {}),
            fields: [
              { field: 'label', label: 'Label' },
              { field: c.sub, label: c.sub },
            ],
          },
        ],
      },
    ],
  } as never;
}

function schemaFor(c: DetectorCase) {
  return {
    type: 'object',
    properties: {
      rows: {
        type: 'array',
        title: 'Rows',
        items: { type: 'object', properties: { label: { type: 'string' }, [c.sub]: c.schema } },
      },
    },
  } as never;
}

function renderCase(c: DetectorCase, layout: 'grid' | 'card') {
  render(
    <SchemaForm
      schema={schemaFor(c)}
      form={formFor(c, layout)}
      value={{ rows: [{ label: 'a' }] }}
      widgetContext={ctx}
      onChange={() => {}}
    />,
  );
  if (layout === 'card') fireEvent.click(screen.getByText(/#1/));
}

/** A control that is a plain text box — no `type`, or an explicit `text`. */
function plainTextInputs(root: ParentNode): HTMLInputElement[] {
  return Array.from(root.querySelectorAll('input')).filter(
    (el) => (el.getAttribute('type') ?? 'text') === 'text',
  );
}

describe('#9859 — grid cells and card rows share ONE widget-detection path', () => {
  for (const c of CASES) {
    it(`${c.detector} reaches a GRID cell — it renders ${c.faceName}`, () => {
      renderCase(c, 'grid');

      const cells = Array.from(document.querySelectorAll('td'));
      expect(cells.length, 'the grid layout did not render').toBeGreaterThan(0);

      // The face must be inside a CELL — not merely somewhere on the page.
      const found = cells.some((td) => c.face(td) !== null);
      expect(found, `no grid cell renders ${c.faceName}; ${c.detector} did not run`).toBe(true);

      // Same render, same corpus: the plain column is untouched, so this is a
      // detector firing and not a chain that rewrites every cell.
      const plainCell = cells.find((td) => plainTextInputs(td).length > 0);
      expect(plainCell, 'the plain `label` column lost its text input').toBeTruthy();
    });

    it(`${c.detector} resolves the CARD row to the same face — the asymmetry is gone`, () => {
      renderCase(c, 'card');

      // Control: this layout has no table at all, so nothing here can be read
      // as the grid path passing by accident.
      expect(document.querySelector('td')).toBeNull();
      expect(
        c.face(document),
        `the card layout stopped rendering ${c.faceName} — this pin's control is dead`,
      ).not.toBeNull();
      expect(plainTextInputs(document).length, 'the plain `label` row lost its text input')
        .toBeGreaterThan(0);
    });
  }

  it('a credential column in a grid repeater is actually MASKED', () => {
    const secret = CASES.find((c) => c.detector === 'detectSecretWidget')!;
    renderCase(secret, 'grid');

    const masked = document.querySelector('td input[type="password"]') as HTMLInputElement | null;
    expect(masked, 'the apiKey column is not masked — secret masking is lost in grid layout').not.toBeNull();
    // The typed value is not readable as plain text.
    expect(masked!.type).toBe('password');
    // ...and it is the apiKey CELL that is masked, not some other column: the
    // cell id is path-scoped (objectui#5062), so its last segment names the
    // sub-field this assertion is about.
    expect(masked!.id.endsWith('apiKey'), `masked control has id "${masked!.id}"`).toBe(true);
    // ⚠️ What is deliberately NOT asserted here, because it is NOT true and
    // pinning it would freeze a defect: this cell has no accessible name.
    // `secret` declares `labelling: 'control'`, a contract satisfied by the
    // host's `<label for>` — and a grid row has no label (objectui#5063), so
    // the widget never reads the column-header IDREF the cell hands it. That
    // gap belongs to the `labelling: 'control'` widgets as a class and is
    // reachable without this change: a `type: 'tags'` sub-field resolves to
    // `string-tags` through `inferWidget` alone and is unnamed in a grid cell
    // today. It is filed separately; ⛔ do not "fix" it by reverting the
    // masking, which is what this test exists to keep.
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9889 — a registered widget declared `labelling: 'control'` is named
 * by the column header when it renders inside a grid/table repeater CELL.
 *
 * ## What was measured (baseline `fc12bc8c6`, real `SchemaForm` renders)
 *
 * A grid row has no `<label>` by design: objectui#5063 writes the column name
 * once in the `<th>` and points every cell at it by IDREF, keeping the cell id
 * on the control as a plain anchor. So a cell hands its widget BOTH channels.
 * The nine widgets declared `labelling: 'group'` answered that IDREF; the
 * eleven declared `'control'` read only the id and dropped it, so every one of
 * them rendered as an UNNAMED edit box in every grid row:
 *
 * ```
 * cell, one repeater row      declared   aria-labelledby   aria-label
 * type:'tags' -> string-tags  control    null              null
 * secret                      control    null              null
 * condition                   group      mdf-rows.visible-col   —
 * ```
 *
 * ## The question this file answers, because the fix turns on it
 *
 * `labelling` answers ONE question — can the host's `<label for>` reach a
 * labelable element? — and it stays two-valued: collapsing it re-opens the
 * dangling `for` objectui#3978/#4010 closed. What was wrong is a SECOND meaning
 * read into it: that `'control'` also declares which naming channel the widget
 * consumes. `FieldRow`'s "exactly one of `id` / `ariaLabelledBy`" is a rule
 * about a host THAT HAS A LABEL; `FieldControl`'s builtin branches already say
 * so in as many words and already emit both. Only the registry widgets were
 * left behind. So the repair is not a collapse: every `'control'` widget puts
 * the IDREF on the same labelable element that takes the id.
 *
 * ## What this file pins — both sides, and the exemption
 *
 *  1. every key `WIDGET_LABELLING` declares `'control'` resolves, in a grid
 *     cell, to a control whose ACCESSIBLE NAME is its column — read off a real
 *     render, ⛔ never off a prop or a source string;
 *  2. the case list is checked against the registry itself, so a twelfth
 *     `'control'` widget cannot be added without a reading here;
 *  3. the `'group'` side still answers the same IDREF in the same render — the
 *     control that makes a green `'control'` row admissible rather than a
 *     harness that names everything;
 *  4. the CARD layout of the same spec keeps its plain `<label for>` and gains
 *     NO `aria-labelledby` — the channel that was already correct is untouched;
 *  5. ⭐ the NEGATIVE: the auxiliary affordances inside a `'control'` widget —
 *     a reveal toggle, the hex mirror beside a colour input — are EXEMPT. They
 *     keep their own names and take no IDREF. Without this pin the next reader
 *     "completes" the fix by spreading the naming over every control in the
 *     cell, and a grid row becomes a set of buttons that all announce the
 *     column name.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { SchemaForm } from './SchemaForm';
import { loaded } from './loadState';
import { WIDGET_LABELLING, type RegisteredWidgetKey, type WidgetContext } from './widgets';

afterEach(cleanup);

/** Catalogs that LOADED, so a picker renders its picker and not its failure arm. */
const ctx: WidgetContext = {
  conditionScope: 'flattened',
  objectNames: loaded(['account', 'contact']),
  objectFields: loaded([{ name: 'status', label: 'Status' }]),
  objectViews: loaded([{ name: 'account.all', label: 'All' }]),
  datasets: loaded([{ name: 'sales_metrics', label: 'Sales metrics', dimensions: [], measures: [] }]),
};

/**
 * The column label, and the sub-field name it prettifies FROM. Keeping them in
 * step matters for the card-layout control below: `FieldRow` appends the machine
 * name to a label that does not match it, and that `<code>` would land inside
 * the `<label>` and so inside the computed accessible name.
 */
const SUB = 'trailing_stop';
const COLUMN = 'Trailing Stop';

interface WidgetCase {
  /** The registry key, which the sub-field spec pins explicitly. */
  widget: RegisteredWidgetKey;
  /** Extra JSON Schema for the sub-field, where the face needs one. */
  schema?: Record<string, unknown>;
  /** Extra field-spec keys, where the face needs them. */
  spec?: Record<string, unknown>;
  /** How the widget's PRIMARY control is recognised inside its cell. */
  control: (cell: ParentNode) => Element | null;
  /** What that control is, for the failure message. */
  faceName: string;
}

/** The `labelling: 'control'` widgets. Checked against the registry below. */
const CONTROL_CASES: WidgetCase[] = [
  { widget: 'ref:object', control: (c) => c.querySelector('[role="combobox"]'), faceName: 'the object picker' },
  { widget: 'ref:component', control: (c) => c.querySelector('input'), faceName: 'the free-text component id box' },
  { widget: 'ref:dataset', control: (c) => c.querySelector('[role="combobox"]'), faceName: 'the dataset picker' },
  { widget: 'object-selector', control: (c) => c.querySelector('[role="combobox"]'), faceName: 'the object picker' },
  { widget: 'field-selector', control: (c) => c.querySelector('input'), faceName: 'the "select an object first" box' },
  { widget: 'field-ref', control: (c) => c.querySelector('[role="combobox"]'), faceName: 'the object-field picker' },
  { widget: 'view-ref', control: (c) => c.querySelector('[role="combobox"]'), faceName: 'the view picker' },
  { widget: 'filter-builder', control: (c) => c.querySelector('[data-testid="filter-builder-trigger"]'), faceName: 'the filter popover trigger' },
  { widget: 'icon', control: (c) => c.querySelector('[aria-haspopup="dialog"]'), faceName: 'the icon picker trigger' },
  { widget: 'color-input', control: (c) => c.querySelector('input[type="color"]'), faceName: 'the native colour input' },
  { widget: 'string-tags', control: (c) => c.querySelector('input[type="text"]'), faceName: 'the tag entry box' },
  { widget: 'secret', control: (c) => c.querySelector('input[type="password"]'), faceName: 'the masked credential box' },
];

/**
 * The same-render control. A `'group'` widget reaches the cell's name through
 * the very IDREF the eleven above were dropping, so if the harness were naming
 * things by accident these would be indistinguishable — and if the fix had
 * MOVED the channel instead of widening it, these would go red.
 */
const GROUP_CASES: WidgetCase[] = [
  { widget: 'condition', control: (c) => c.querySelector('[role="group"]'), faceName: 'the condition builder' },
  {
    widget: 'multiselect',
    schema: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } },
    control: (c) => c.querySelector('[role="group"]'),
    faceName: 'the checkbox group',
  },
];

function formFor(c: WidgetCase, layout: 'grid' | 'card') {
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
            fields: [{ field: SUB, label: COLUMN, widget: c.widget, ...(c.spec ?? {}) }],
          },
        ],
      },
    ],
  } as never;
}

function schemaFor(c: WidgetCase) {
  return {
    type: 'object',
    properties: {
      rows: {
        type: 'array',
        title: 'Rows',
        items: { type: 'object', properties: { [SUB]: c.schema ?? { type: 'string' } } },
      },
    },
  } as never;
}

function renderCase(c: WidgetCase, layout: 'grid' | 'card') {
  render(
    <SchemaForm
      schema={schemaFor(c)}
      form={formFor(c, layout)}
      value={{ rows: [{}] }}
      widgetContext={ctx}
      onChange={() => {}}
    />,
  );
  if (layout === 'card') fireEvent.click(screen.getByText(/#1/));
}

/**
  * The one DATA cell of the one-column, one-row grid this file renders. Taken
  * positionally rather than by what it contains, so a cell that renders NOTHING
  * fails the assertion that follows instead of vanishing from the search.
  */
function theCell(): HTMLTableCellElement {
  const cell = document.querySelector('tbody td') as HTMLTableCellElement | null;
  expect(cell, 'the grid layout rendered no data cell at all').not.toBeNull();
  return cell!;
}

describe('#9889 — every registered widget is named by its column header in a grid cell', () => {
  it('the case list IS the registry — a new `control` widget cannot slip in unread', () => {
    const declared = Object.entries(WIDGET_LABELLING)
      .filter(([, v]) => v === 'control')
      .map(([k]) => k)
      .sort();
    expect(CONTROL_CASES.map((c) => c.widget).sort()).toEqual(declared);
    // The other half of the registry, so a mass re-declaration to `'group'`
    // cannot empty this file's subject and still read as green.
    expect(declared.length + Object.values(WIDGET_LABELLING).filter((v) => v === 'group').length)
      .toBe(Object.keys(WIDGET_LABELLING).length);
  });

  for (const c of [...CONTROL_CASES, ...GROUP_CASES]) {
    const declared = WIDGET_LABELLING[c.widget];
    it(`\`${c.widget}\` (labelling: ${declared}) — ${c.faceName} in a grid cell is named by its column`, () => {
      renderCase(c, 'grid');
      const cell = theCell();

      const control = c.control(cell);
      expect(control, `the cell renders no ${c.faceName}`).not.toBeNull();

      // The channel, resolved: an IDREF that lands on this column's header.
      const ref = control!.getAttribute('aria-labelledby');
      expect(ref, `${c.widget} dropped the column-header IDREF — the cell is an unnamed control`).not.toBeNull();
      const header = document.getElementById(ref!);
      expect(header, `aria-labelledby="${ref}" resolves to nothing`).not.toBeNull();
      expect(header!.tagName).toBe('TH');

      // ...and the name that actually reaches assistive technology.
      expect(control).toHaveAccessibleName(COLUMN);
    });
  }

  for (const c of CONTROL_CASES) {
    it(`\`${c.widget}\` puts BOTH channels on the same element — the id stays a plain anchor`, () => {
      renderCase(c, 'grid');
      const control = c.control(theCell());
      // The `'control'` contract: the host id sits on the ONE labelable element
      // that is the field's primary control. That is the element the IDREF must
      // name, or the two channels have drifted onto different nodes.
      expect(control!.id, `${c.widget}: the named control does not carry the cell id`).not.toBe('');
      expect(control!.id.endsWith(SUB), `the named control has id "${control!.id}"`).toBe(true);
    });
  }
});

describe('#9889 — the card layout is untouched: `<label for>`, and no second channel', () => {
  for (const c of CONTROL_CASES) {
    it(`\`${c.widget}\` in a card row is still named the plain way`, () => {
      renderCase(c, 'card');
      // Control: this layout renders no table, so nothing here can be the grid
      // path passing by accident.
      expect(document.querySelector('td')).toBeNull();

      const label = screen.getByText(COLUMN).closest('label');
      expect(label, 'the card row lost its visible label').not.toBeNull();
      const target = document.getElementById(label!.getAttribute('for')!);
      expect(target, `label[for="${label!.getAttribute('for')}"] resolves to nothing`).not.toBeNull();
      expect(target).toHaveAccessibleName(COLUMN);
      // One label, one channel: a host that HAS a label sends no IDREF, so the
      // widening must not have turned this row into two associations.
      expect(target).not.toHaveAttribute('aria-labelledby');
    });
  }
});

describe('#9889 — ⭐ the NEGATIVE: auxiliary affordances are exempt and keep their own names', () => {
  it("`secret`'s reveal toggle is not renamed after the column", () => {
    renderCase(CONTROL_CASES.find((c) => c.widget === 'secret')!, 'grid');
    const cell = theCell();

    // The control that IS the field takes the column name...
    expect(cell.querySelector('input[type="password"]')).toHaveAccessibleName(COLUMN);

    // ...and the toggle beside it does not. It names its own action, which is
    // the whole reason `controlNaming` is not spread over a widget's subtree.
    const toggle = cell.querySelector('button');
    expect(toggle, 'the reveal toggle disappeared — this negative has no subject').not.toBeNull();
    expect(toggle).not.toHaveAttribute('aria-labelledby');
    expect(toggle).toHaveAccessibleName();
    expect(toggle!.getAttribute('aria-label')).not.toBe(COLUMN);
  });

  it("`color-input`'s hex mirror keeps its own name beside the named swatch", () => {
    renderCase(CONTROL_CASES.find((c) => c.widget === 'color-input')!, 'grid');
    const cell = theCell();

    expect(cell.querySelector('input[type="color"]')).toHaveAccessibleName(COLUMN);

    const hex = cell.querySelector('input[type="text"], input:not([type])');
    expect(hex, 'the hex mirror disappeared — this negative has no subject').not.toBeNull();
    expect(hex).not.toHaveAttribute('aria-labelledby');
    expect(hex).toHaveAccessibleName();
    expect(hex!.getAttribute('aria-label')).not.toBe(COLUMN);
  });
});

// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins that a picklist option this designer CANNOT represent is reported on
 * screen and survives the next edit, instead of rendering blank and then being
 * deleted (objectui#8632).
 *
 * ## The half that did the damage is the DELETION, not the blank row
 *
 * `readOptions` used to open with `value: String(o?.value ?? '')`, so every
 * entry it could not read became `value: ''` — a row with two empty boxes.
 * `OptionsEditor.commit` persists only rows with a non-empty `value`. So the
 * author saw nothing wrong AND lost the content on the next touch of the option
 * editor. Measured on the unfixed reader, `options: ['draft','open','closed']`:
 *
 *   render                       -> 3 rows, values ["","",""], labels ["","",""]
 *   click "Add value" (no typing) -> options: []                <- three options gone
 *   one reorder click             -> options: []
 *   type "alpha" into row 0       -> options: [{value:"alpha",label:""}]
 *
 * ⚠️ CORRECTION to the card's own account, measured on the unfixed reader and
 * pinned below so it is not re-asserted: an edit to an UNRELATED control on the
 * same field — Description, Label, Required — never rewrote `options` at all.
 * `patchDef` spreads `def` and patches only the keys it is handed. The trigger
 * is any interaction INSIDE the option editor, which is exactly where an author
 * looking at an empty-looking option list goes next. The reachability is worse
 * than the card claimed, not better: it costs one click, before a character is
 * typed.
 *
 * ## "Malformed" was never one shape — it is two families
 *
 * Both measured on the unfixed reader. A repair that caught only the first
 * would have looked complete:
 *
 *   COLLAPSED to an empty row, then deleted — a bare string, `null`, `5`,
 *   `true`, `{}`, `{ label } with no value`, `{ value: '' }`, `{ value: null }`,
 *   a nested array.
 *
 *   SILENTLY REWRITTEN into a different document, never deleted, never visibly
 *   wrong — `{ value: 5 }` -> `"5"`, `{ value: true }` -> `"true"`,
 *   `{ value: ['alpha'] }` -> `"alpha"` (indistinguishable on screen from a
 *   well-formed option), `{ value: { a: 1 } }` -> `"[object Object]"`,
 *   `{ label: 5 }` -> `label: ''`, `{ color: 16711680 }` -> `color` dropped.
 *
 * The second family is `String()` coercion — AGENTS.md #0.1 consumer-side
 * tolerance — which is why the repair REMOVES that expression rather than
 * widening it further.
 *
 * ## Two boundaries, both prior rulings rather than oversights
 *
 *   • `{ value: 'alpha' }` with NO `label` key still commits `label: ''`. That
 *     is the objectui#7014 Q2 ruling and it is pinned here as a control.
 *   • `{ value: 'a', label: 'A' }` — representable here, rejected by the spec
 *     (`too_small@[value]`, the two-character minimum). It stays an ordinary
 *     editable row; the draft validator names it. This reader reports only what
 *     it cannot SHOW.
 *
 * Every case is refusal-shaped: it asserts what the WRITTEN document carries,
 * and the preserved entries are put back to `FieldSchema` to show that
 * preserving them is not a claim that they are valid — the gate still refuses
 * the document, which is the whole point of not silently repairing it.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { SelectOptionSchema, FieldSchema } from '@objectstack/spec/data';

vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({
    list: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { ObjectFieldInspector } from './ObjectFieldInspector';

afterEach(cleanup);

type Def = Record<string, unknown>;

function renderField(options: unknown[]) {
  const onPatch = vi.fn();
  render(
    <ObjectFieldInspector
      type="object"
      name="probe_widget"
      draft={{ name: 'probe_widget', fields: { status: { type: 'select', label: 'Status', options } } }}
      selection={{ kind: 'field', id: 'status' }}
      onPatch={onPatch}
      onClearSelection={vi.fn()}
      onSelectionChange={vi.fn()}
      readOnly={false}
      locale={'en-US'}
    />,
  );
  /** The option list the designer would persist for `status` after the last edit. */
  const savedOptions = (): unknown[] => {
    const call = onPatch.mock.calls.at(-1);
    if (!call) throw new Error('the editor never called onPatch — no round trip to measure');
    const fields = call[0].fields as Record<string, Def>;
    return ((fields.status as { options?: unknown[] }).options ?? []) as unknown[];
  };
  return { onPatch, savedOptions };
}

/** The rows the editor offers as editable options (a malformed row has no inputs). */
const editableRows = () => screen.queryAllByPlaceholderText('value') as HTMLInputElement[];
/** The rows the editor refuses to represent. */
const malformedRows = () => screen.queryAllByTestId('option-malformed');

/** Add a value: one click, nothing typed. The cheapest trigger there is. */
const clickAddValue = () => fireEvent.click(screen.getByText('Add value'));

/** The structural slice of a Zod schema this file needs -- no `any` (AGENTS.md #6). */
type SpecIssue = { code: string; path: ReadonlyArray<PropertyKey> };
type SpecSchema = {
  safeParse: (value: unknown) => { success: boolean; error?: { issues: SpecIssue[] } };
};
const rejectionsOf = (schema: SpecSchema, doc: unknown): string[] => {
  const r = schema.safeParse(doc);
  return r.success ? [] : (r.error?.issues ?? []).map((i) => `${i.code}@[${i.path.join('.')}]`);
};

describe('ObjectFieldInspector · the destructive half — a malformed option is no longer deleted (objectui#8632)', () => {
  it('one click on "Add value", nothing typed, no longer erases three authored options', () => {
    const { savedOptions } = renderField(['draft', 'open', 'closed']);

    // The rows are visible AS malformed before anything is touched, so the
    // author is not clicking blind.
    expect(malformedRows()).toHaveLength(3);

    clickAddValue();

    // THE PIN. Before the repair this read `[]`.
    expect(savedOptions()).toEqual(['draft', 'open', 'closed']);
    // LIT CONTROL: the click really reached the writer and really added a row,
    // so the assertion above measures a round trip rather than a render that
    // never called `onChange`. The blank row the click created is filtered on
    // commit (that filter is unchanged), which is why the written list is three
    // and the on-screen editable rows are one.
    expect(editableRows()).toHaveLength(1);
  });

  it('a reorder click preserves them — in the new order, and still verbatim', () => {
    const { savedOptions } = renderField(['draft', 'open', 'closed']);
    fireEvent.click(screen.getAllByLabelText('Move down')[0]);
    expect(savedOptions()).toEqual(['open', 'draft', 'closed']);
  });

  it('typing into a WELL-FORMED row does not erase its malformed siblings', () => {
    const { savedOptions } = renderField(['draft', { value: 'open', label: 'Open' }, 'closed']);
    fireEvent.change(screen.getByPlaceholderText('Label'), { target: { value: 'Open now' } });
    expect(savedOptions()).toEqual(['draft', { value: 'open', label: 'Open now' }, 'closed']);
  });

  it('preserving it is NOT a claim that it is valid — the document still fails the contract', () => {
    const { savedOptions } = renderField(['draft']);
    clickAddValue();
    const written = savedOptions();
    expect(written).toEqual(['draft']);
    // The gate keeps refusing the field, which is what makes the preservation
    // honest: the author is told, the content is kept, and nothing pretends the
    // draft is saveable until they repair it.
    expect(rejectionsOf(SelectOptionSchema as SpecSchema, written[0]).length).toBeGreaterThan(0);
    expect(
      rejectionsOf(FieldSchema as SpecSchema, { name: 'status', type: 'select', label: 'Status', options: written })
        .length,
    ).toBeGreaterThan(0);
  });

  it('the escape path is one deliberate click — Remove drops it, and only it', () => {
    // ZONE 2 D: the author is never trapped. Removing the row reproduces
    // exactly the old outcome, with the author choosing it.
    const { savedOptions } = renderField(['draft', { value: 'open', label: 'Open' }]);
    const row = malformedRows()[0];
    fireEvent.click(within(row).getByLabelText('Remove'));
    expect(savedOptions()).toEqual([{ value: 'open', label: 'Open' }]);
    expect(malformedRows()).toHaveLength(0);
  });
});

describe('ObjectFieldInspector · the invisibility half — the row says what is wrong', () => {
  it('reports the reason and shows the authored entry verbatim, instead of two blank boxes', () => {
    renderField(['draft']);
    const row = malformedRows()[0];
    expect(row).toBeTruthy();
    expect(row.getAttribute('role')).toBe('alert');
    expect(within(row).getByText('This option cannot be edited here')).toBeTruthy();
    expect(within(row).getByText('It is not an option object.')).toBeTruthy();
    // The authored entry, so the author can recognise their own content.
    expect(within(row).getByText('"draft"')).toBeTruthy();
    // ...and no blank editable row impersonating it.
    expect(editableRows()).toHaveLength(0);
  });

  it('names the RIGHT reason per shape — a class report, not one message for everything', () => {
    const cases: Array<[unknown, string]> = [
      [{ label: 'Draft' }, 'Its `value` is missing or is not text.'],
      [{ value: '', label: 'Draft' }, 'Its `value` is empty.'],
      [{ value: 'draft', label: 5 }, 'Its `label` is not text.'],
      [{ value: 'draft', label: 'Draft', color: 16711680 }, 'Its `color` is not text.'],
    ];
    for (const [authored, expected] of cases) {
      cleanup();
      renderField([authored]);
      expect(within(malformedRows()[0]).getByText(expected)).toBeTruthy();
    }
  });
});

describe('ObjectFieldInspector · the census — both families of malformed option', () => {
  // Family 1 was collapsed to a blank row and DELETED. Family 2 was silently
  // REWRITTEN and never looked wrong. Every entry here is asserted the same
  // way, which is the point: one rule replaced a list of shapes.
  const family1: Array<[string, unknown]> = [
    ['a bare string', 'draft'],
    ['null', null],
    ['a number', 5],
    ['a boolean', true],
    ['an empty object', {}],
    ['an option with no value', { label: 'Draft' }],
    ['an authored empty value', { value: '', label: 'Draft' }],
    ['a null value', { value: null, label: 'Draft' }],
    ['a nested array', ['draft', 'open']],
  ];
  const family2: Array<[string, unknown]> = [
    ['a numeric value', { value: 5, label: 'Five' }],
    ['a boolean value', { value: true, label: 'Yes' }],
    ['an object value', { value: { a: 1 }, label: 'Obj' }],
    ['an array value', { value: ['alpha'], label: 'Arr' }],
    ['a non-string label', { value: 'alpha', label: 5 }],
    ['a non-string color', { value: 'alpha', label: 'Alpha', color: 16711680 }],
  ];

  for (const [family, cases] of [
    ['family 1 (was rendered blank, then deleted)', family1] as const,
    ['family 2 (was silently rewritten into a different document)', family2] as const,
  ]) {
    for (const [name, authored] of cases) {
      it(`${family}: ${name} is reported and survives a sibling edit verbatim`, () => {
        const { savedOptions } = renderField([authored, { value: 'zzz9', label: 'Sentinel' }]);
        expect(malformedRows()).toHaveLength(1);
        // Edit the OTHER row -- the trigger that used to destroy this one.
        fireEvent.change(screen.getByPlaceholderText('Label'), { target: { value: 'Sentinel II' } });
        expect(savedOptions()).toEqual([authored, { value: 'zzz9', label: 'Sentinel II' }]);
      });
    }
  }
});

describe('ObjectFieldInspector · the control — a well-formed option set is untouched', () => {
  it('renders and commits exactly as before, key for key', () => {
    const { savedOptions } = renderField([
      { value: 'alpha', label: 'Alpha', color: '#ff0000' },
      { value: 'beta', label: 'Beta', default: true, visibleWhen: 'x > 1' },
    ]);
    // No refusal anywhere on a clean document.
    expect(malformedRows()).toHaveLength(0);
    expect(editableRows()).toHaveLength(2);

    fireEvent.change(screen.getAllByPlaceholderText('Label')[0], { target: { value: 'Alpha II' } });

    // Byte for byte the projection this editor has always written: `rest`
    // spread first (objectui#7540), `label` always emitted, `color` only when
    // truthy.
    expect(savedOptions()).toEqual([
      { value: 'alpha', label: 'Alpha II', color: '#ff0000' },
      { default: true, visibleWhen: 'x > 1', value: 'beta', label: 'Beta' },
    ]);
    for (const written of savedOptions()) {
      expect(rejectionsOf(SelectOptionSchema as SpecSchema, written)).toEqual([]);
    }
  });

  it("the editor's own blank trailing row is still filtered on commit", () => {
    // This is what the `value.trim() !== ''` filter was written for, and it is
    // deliberately unchanged. An AUTHORED empty value is a different fact and
    // is covered by the census above.
    const { savedOptions } = renderField([{ value: 'alpha', label: 'Alpha' }]);
    clickAddValue();
    expect(editableRows()).toHaveLength(2);
    expect(savedOptions()).toEqual([{ value: 'alpha', label: 'Alpha' }]);
  });

  it('an option with NO label key still commits `label: ""` (objectui#7014 Q2, preserved)', () => {
    const { savedOptions } = renderField([{ value: 'alpha' }, { value: 'beta', label: 'Beta' }]);
    expect(malformedRows()).toHaveLength(0);
    fireEvent.change(screen.getAllByPlaceholderText('Label')[1], { target: { value: 'Beta II' } });
    expect(savedOptions()).toEqual([
      { value: 'alpha', label: '' },
      { value: 'beta', label: 'Beta II' },
    ]);
  });

  it('a value the SPEC rejects but this editor can show stays an ordinary editable row', () => {
    const { savedOptions } = renderField([{ value: 'a', label: 'A' }]);
    expect(malformedRows()).toHaveLength(0);
    expect(editableRows()).toHaveLength(1);
    fireEvent.change(screen.getByPlaceholderText('Label'), { target: { value: 'A II' } });
    expect(savedOptions()).toEqual([{ value: 'a', label: 'A II' }]);
    // The reader does not report it; the contract does, and that division is
    // the reason this row is left alone.
    expect(rejectionsOf(SelectOptionSchema as SpecSchema, { value: 'a', label: 'A II' })).toEqual([
      'too_small@[value]',
    ]);
  });
});

describe('ObjectFieldInspector · the premise correction — what an unrelated edit actually does', () => {
  it('an edit to another control on the same field never rewrites `options`', () => {
    // Measured identically on the unfixed reader. `patchDef` spreads `def` and
    // patches only the keys handed to it, so `options` travels untouched. The
    // card and its PM note both described the deletion as reachable this way;
    // it is not, and pinning that keeps the next reader from re-asserting it.
    const { savedOptions } = renderField(['draft', 'open', 'closed']);
    const description = document.querySelectorAll('textarea')[0];
    fireEvent.change(description, { target: { value: 'the field description' } });
    fireEvent.blur(description);
    expect(savedOptions()).toEqual(['draft', 'open', 'closed']);
  });
});

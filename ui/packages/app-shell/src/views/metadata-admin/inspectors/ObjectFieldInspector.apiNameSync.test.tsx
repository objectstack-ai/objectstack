// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ObjectFieldInspector — the API name follows the Label for as long as the
 * Label owns it (objectui#7615).
 *
 * The measurement that opened the card is a CONTRAST, and this file keeps it:
 * the same target string reached two ways used to give two answers.
 *
 *   • `fill("Health Score")` — ONE input event  -> `health_score`  ✅ (always did)
 *   • `pressSequentially`    — one event per key -> `h`            ❌ (the bug)
 *
 * A single-`change` test therefore cannot see this defect; every case below
 * that asserts syncing types the label ONE CHARACTER AT A TIME, which is what
 * a person at a keyboard actually does.
 *
 * The three boundaries under test (PM ruling on #7615, restating #2260):
 *   1. new + untouched API name -> re-derive on EVERY label change;
 *   2. a field that arrived already named (i.e. saved) -> never re-derive;
 *   3. once the AUTHOR types in the API name box -> never re-derive, even when
 *      what they typed happens to look like an auto-generated placeholder.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

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

/**
 * A host that behaves like the real one (StudioDesignSurface): it feeds every
 * patch back in as the next `draft` AND follows the rename with the selection.
 * Static props cannot express this defect — each keystroke has to see the
 * PREVIOUS keystroke's rename in `entry.name`.
 */
function Host({ fields: initial, id }: { fields: Record<string, Record<string, unknown>>; id: string }) {
  const [fields, setFields] = React.useState(initial);
  const [selection, setSelection] = React.useState<any>({ kind: 'field', id });
  return (
    <ObjectFieldInspector
      type="object"
      name="account"
      draft={{ name: 'account', fields }}
      selection={selection}
      onPatch={(patch: any) => setFields(patch.fields)}
      onClearSelection={() => {}}
      onSelectionChange={(next: any) => next && setSelection(next)}
      readOnly={false}
      locale={'en-US'}
    />
  );
}

function controlFor(label: string): HTMLInputElement {
  const lab = screen.getByText(label);
  return lab.parentElement!.querySelector('input, textarea') as HTMLInputElement;
}

/** One `change` event per character — the `pressSequentially` shape. */
function typeInto(label: string, text: string): void {
  for (let i = 1; i <= text.length; i += 1) {
    fireEvent.change(controlFor(label), { target: { value: text.slice(0, i) } });
  }
}

describe('ObjectFieldInspector — API name follows the label while the label owns it (#7615)', () => {
  it('keeps syncing on EVERY keystroke, not just the first one', () => {
    render(<Host fields={{ field_10: { type: 'text', label: 'New field' } }} id="field_10" />);
    typeInto('Label', 'Health Score');
    expect(controlFor('Label')).toHaveValue('Health Score');
    // Pre-fix this reads `h`: the first keystroke renamed `field_10` -> `h`,
    // which destroyed the very placeholder shape the derivation gated on.
    expect(controlFor('API name')).toHaveValue('health_score');
  });

  it('reaches the same API name as a single paste of the same label (the contrast)', () => {
    render(<Host fields={{ field_10: { type: 'text', label: 'New field' } }} id="field_10" />);
    // One input event — the `fill()` half of the card's measurement. Green
    // before and after the fix; it is the control, not the detector.
    fireEvent.change(controlFor('Label'), { target: { value: 'Health Score' } });
    expect(controlFor('API name')).toHaveValue('health_score');
  });

  it('tracks a label the author keeps editing (backspace and retype)', () => {
    render(<Host fields={{ field_3: { type: 'text', label: '' } }} id="field_3" />);
    typeInto('Label', 'Close Dat');
    expect(controlFor('API name')).toHaveValue('close_dat');
    // Author backspaces the typo and finishes the word.
    fireEvent.change(controlFor('Label'), { target: { value: 'Close Da' } });
    typeInto('Label', 'Close Date');
    expect(controlFor('API name')).toHaveValue('close_date');
  });

  it('stops the moment the author edits the API name themselves', () => {
    render(<Host fields={{ field_4: { type: 'text', label: '' } }} id="field_4" />);
    typeInto('Label', 'Health');
    expect(controlFor('API name')).toHaveValue('health');
    typeInto('API name', 'hs_code');
    typeInto('Label', 'Health Score');
    expect(controlFor('Label')).toHaveValue('Health Score');
    expect(controlFor('API name')).toHaveValue('hs_code');
  });

  it('stops even when the author typed something SHAPED like an auto name', () => {
    // The third state the triage seat flagged: a hand-typed `field_9` is the
    // author's value. Answering "is this still auto?" by pattern-matching the
    // string alone cannot tell it apart from `nextFieldName()`'s output.
    render(<Host fields={{ field_5: { type: 'text', label: '' } }} id="field_5" />);
    typeInto('API name', 'field_9');
    expect(controlFor('API name')).toHaveValue('field_9');
    typeInto('Label', 'Health Score');
    expect(controlFor('Label')).toHaveValue('Health Score');
    expect(controlFor('API name')).toHaveValue('field_9');
  });

  it('never renames a field that arrived already named (the saved case)', () => {
    // A field loaded from a saved object: its name is authoritative, and a
    // rename here would break the REST API, formulas and exports pointing at
    // it. This is #2260's "lock it on first save" boundary.
    render(<Host fields={{ priority: { type: 'text', label: 'Priority' } }} id="priority" />);
    typeInto('Label', 'Urgency');
    expect(controlFor('Label')).toHaveValue('Urgency');
    expect(controlFor('API name')).toHaveValue('priority');
  });

  it('leaves the placeholder name in place for a label with no Latin slug', () => {
    render(<Host fields={{ field_6: { type: 'text', label: '' } }} id="field_6" />);
    typeInto('Label', '健康评分');
    expect(controlFor('Label')).toHaveValue('健康评分');
    expect(controlFor('API name')).toHaveValue('field_6');
  });
});

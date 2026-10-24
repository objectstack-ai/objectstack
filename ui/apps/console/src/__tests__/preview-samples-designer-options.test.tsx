// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `object` preview sample, read by the DESIGNER that renders it
 * (objectui#6844).
 *
 * This sample's `status.options` were three bare strings, a shape `FieldSchema`
 * refuses. `preview-samples-spec-valid.test.ts` now pins the contract half. This
 * file pins the half a person actually sees, because the defect was masked
 * TWICE and closing only one mask leaves the next one invisible:
 *
 *  1. Zod short-circuits at `objects.0.fields` on the sample's deliberate array
 *     shape, so the options were never validated — the GATES could not see it.
 *     (Pinned in the sibling file, by lifting the array to a record.)
 *  2. `ObjectFieldInspector`'s `readOptions()` maps every entry through
 *     `String(o?.value ?? '')`, which turns a bare string into an option with an
 *     EMPTY value and no label. Three malformed options therefore rendered as
 *     three BLANK rows in the picklist editor — a person opening the sample in
 *     the designer saw an empty option list rather than an error. That is this
 *     file.
 *
 * ⚠️ `undefined === undefined` is the trap this file exists to avoid. A pin
 * asserting "the option editor renders three rows" passes on three blank ones,
 * and a pin comparing two empty strings proves nothing at all. Every assertion
 * below therefore names CONCRETE text — the codes and faces the sample teaches.
 *
 * The inspector is taken from the registry rather than imported, which is the
 * route the console itself uses (`getMetadataInspector('object')`, registered by
 * app-shell's `registerBuiltinDesigners`, which the package entry runs once the
 * chunk it imports dynamically has loaded). So this renders the designer as
 * WIRED, not a component picked out by hand.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { getMetadataInspector } from '@object-ui/app-shell';
import { SAMPLES } from '../preview-samples';
// The built-in designers. Importing the @object-ui/app-shell root registers them
// from a chunk it loads with a dynamic `import()` (objectui#11939 step 2), so
// they land after this module has run. Loaded and registered here, at module
// scope — the import phase, outside every test's window — by the function the
// root calls when that chunk arrives, so the registry read below returns the
// real built-in designer.
//
// `vi.importActual` and a workspace SOURCE path, not an `import` statement: the
// package publishes no subpath and the function is not on its barrel, and a
// static import would put the designers' sources into this app's `tsc` program,
// which checks them under rules their own package does not apply.
const { registerBuiltinDesigners } = await vi.importActual<{ registerBuiltinDesigners: () => void }>(
  '../../../../packages/app-shell/src/views/metadata-admin/register-builtin-designers',
);
registerBuiltinDesigners();

/**
 * ONE fetch double, installed at module scope and never torn down
 * (objectui#6640 / #7439). The inspector's `useObjectFields` issues a
 * fire-and-forget `/meta/object` read that no barrier awaits, so a per-test
 * teardown would restore the real fetch while the tree is still mounted and
 * the read would escape to a live socket — happy-dom's document URL is
 * `http://localhost:3000`, so a relative fetch is a real TCP connection.
 * Nothing here depends on what the probe returns: the sample is passed in as
 * `draft`, and the catalog this serves only feeds the LOOKUP target picker.
 */
vi.stubGlobal(
  'fetch',
  vi.fn(async () =>
    new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
  ),
);

afterEach(cleanup);

/** The English placeholders of the two inputs each option row carries. */
const VALUE_BOX = 'value';
const LABEL_BOX = 'Label';

function renderStatusInspector() {
  const Inspector = getMetadataInspector('object');
  // Not a formality: a missing registration would otherwise surface as
  // React's "Element type is invalid", which reads like a broken test rather
  // than a broken wiring.
  expect(Inspector).toBeTruthy();
  const Component = Inspector as NonNullable<typeof Inspector>;
  render(
    <Component
      type="object"
      name={String(SAMPLES.object.name)}
      // The REAL sample, verbatim — including its deliberate array `fields`,
      // so the inspector reaches `status` through `readFields()`'s array branch
      // exactly as the preview gallery does.
      draft={SAMPLES.object}
      selection={{ kind: 'field', id: 'status' }}
      onPatch={vi.fn()}
      onClearSelection={vi.fn()}
      onSelectionChange={vi.fn()}
      readOnly={false}
      locale="en-US"
    />,
  );
}

/** The text currently sitting in each box of the picklist editor. */
const boxValues = (placeholder: string): string[] =>
  screen.getAllByPlaceholderText(placeholder).map((el) => (el as HTMLInputElement).value);

describe('object preview sample · the designer can read its picklist (objectui#6844)', () => {
  it('reaches `status` through the array `fields` branch and renders it', () => {
    renderStatusInspector();
    // The field the selection names resolved out of an ARRAY `fields` draft —
    // the branch this sample exists to cover. Its own Label box carries the
    // authored face, so this is not satisfied by an empty inspector shell.
    expect(screen.getAllByDisplayValue('Status').length).toBeGreaterThan(0);
  });

  it('shows all three options — not three blank rows', () => {
    renderStatusInspector();

    // Count first. Deleting the options would leave the editor's single blank
    // starter row, so `3` is itself load-bearing.
    expect(boxValues(VALUE_BOX)).toHaveLength(3);
    expect(boxValues(LABEL_BOX)).toHaveLength(3);

    // Then the content, literally. Before the fix every one of these six boxes
    // was '' — `readOptions` produced `value: String(o?.value ?? '')` = '' and
    // no label at all, and the editor rendered `value={o.label ?? ''}`.
    expect(boxValues(VALUE_BOX)).toEqual(['draft', 'open', 'closed']);
    expect(boxValues(LABEL_BOX)).toEqual(['Draft', 'Open', 'Closed']);

    // Said once more as the property that actually failed, so a future reader
    // sees the claim and not only the fixtures: no box is blank.
    for (const text of [...boxValues(VALUE_BOX), ...boxValues(LABEL_BOX)]) {
      expect(text).not.toBe('');
    }
  });
});

/**
 * "Match on" offers only the mapped fields the server takes as a match key
 * (objectstack#27567).
 *
 * The server refuses a match key whose value is a list or a structured payload
 * (`multiValueMatchKeyRefusal`, objectstack#27465): a `multiple: true`
 * lookup or select, a multiselect / tags / checkboxes field, and a JSON-stored
 * type. The wizard offered every mapped field, so the user could tick one the
 * import then refused at Validate. It now reads the same spec definitions.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ImportWizard } from './ImportWizard';

beforeAll(() => {
  // Radix Select reads these on open; happy-dom lacks them.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false);
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
});

const FIELDS = [
  { name: 'code', label: 'code', type: 'text' },
  { name: 'email', label: 'email', type: 'email' },
  { name: 'owner', label: 'owner', type: 'lookup' },
  { name: 'owners', label: 'owners', type: 'lookup', multiple: true },
  { name: 'stage', label: 'stage', type: 'select', options: ['a', 'b'] },
  { name: 'stages', label: 'stages', type: 'select', options: ['a', 'b'], multiple: true },
  { name: 'labels', label: 'labels', type: 'tags' },
  { name: 'regions', label: 'regions', type: 'multiselect', options: ['a', 'b'] },
  { name: 'meta', label: 'meta', type: 'json' },
  { name: 'site', label: 'site', type: 'address' },
];

/** Paste TSV into the upload step via the wizard's window-level handler. */
function pasteRows(text: string) {
  const evt = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: (type: string) => string };
  };
  evt.clipboardData = { getData: (type: string) => (type === 'text/plain' ? text : '') };
  act(() => { window.dispatchEvent(evt); });
}

async function toMatchFields() {
  const headers = FIELDS.map((f) => f.name);
  pasteRows(`${headers.join('\t')}\n${headers.map(() => 'x').join('\t')}`);
  fireEvent.click(await screen.findByTestId('import-next-btn'));
  return screen.findByTestId('import-matchfields');
}

describe('"Match on" offers only the fields the server takes as a match key (objectstack#27567)', () => {
  it('leaves out a list or structured field and offers the single-value ones', async () => {
    render(
      <ImportWizard
        objectName="deal"
        fields={FIELDS}
        dataSource={{}}
        open
        onOpenChange={() => {}}
        writeModes={['upsert']}
      />,
    );
    await toMatchFields();

    const offered = FIELDS
      .map((f) => f.name)
      .filter((name) => screen.queryByTestId(`import-matchfield-${name}`) !== null);
    expect(offered).toEqual(['code', 'email', 'owner', 'stage']);
  });
});

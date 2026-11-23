/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A tap anywhere on a lookup quick-picker option selects that option —
 * objectstack#36479.
 *
 * Seen on the showcase Field Zoo record at 375 px: editing the Master-Detail
 * field (target: Project) and tapping the record chip `Account: Fabrikam`
 * inside an option's preview opened the Fabrikam record mid-edit; the option
 * was not selected. The preview draws each column through the read cell, and
 * the read cell draws a reference as a link to its record whenever the host
 * answers `recordHref`. The link's own click handler stops propagation and
 * hands the click to the host's `openRecord`, so the option row never heard it
 * — whatever the pointer: a mouse click on a desktop did the same.
 *
 * The rule is the picker table's (objectui#11903, point 7), now held by the
 * one renderer both picker surfaces call (`renderLookupColumnValue`): a
 * candidate's column never renders as a navigational link. A reference keeps
 * its face (the record page's chip) without the anchor, and a type that draws
 * its own anchor (`mailto:`, a URL, `tel:`, a file) is drawn with the text face.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { RelatedRecordActionsProvider } from '@object-ui/react';
import { LookupField } from './LookupField';
// Installs the cell-renderer resolver the preview draws its values with, and
// the record page's chip context.
import { ReferenceChipContext } from '../index';

/** The referenced object (`showcase_project`) as `getObjectSchema` serves it. */
const FIELDS: Record<string, Record<string, unknown>> = {
  name: { type: 'text', label: 'Project Name' },
  account: { type: 'lookup', label: 'Account', reference: 'showcase_account' },
  contact_email: { type: 'email', label: 'Contact Email' },
};

const ROW = {
  id: 'prj_1',
  name: 'Website Relaunch',
  // As the candidate query serves it, `$expand`-ed (objectui#10223).
  account: { id: 'acc_9', name: 'Fabrikam' },
  contact_email: 'pm@fabrikam.example.com',
};

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [ROW], total: 1 })),
    findOne: vi.fn(async () => ROW),
    getObjectSchema: vi.fn(async (objectName: string) => ({ name: objectName, fields: FIELDS })),
  };
}

/** The record page's host: it routes every object, and opens records in-app. */
function makeHost() {
  return {
    recordHref: (objectName: string, recordId: string | number) =>
      `/apps/showcase/${objectName}/record/${encodeURIComponent(String(recordId))}`,
    openRecord: vi.fn(),
  };
}

async function openPicker(columns: string[]) {
  const host = makeHost();
  const onChange = vi.fn();
  render(
    // The record page's field area: references are drawn as chips (objectstack#36147).
    <RelatedRecordActionsProvider value={host as never}>
      <ReferenceChipContext.Provider value>
        <LookupField
          value={undefined}
          onChange={onChange}
          dataSource={makeDataSource() as never}
          field={{
            reference: 'showcase_project',
            displayField: 'name',
            lookupColumns: columns.map((field) => ({ field, label: FIELDS[field].label as string })),
          } as never}
        />
      </ReferenceChipContext.Provider>
    </RelatedRecordActionsProvider>,
  );
  await act(async () => {
    fireEvent.click(screen.getByTestId('lookup-trigger'));
  });
  await waitFor(() => expect(screen.getByText('Website Relaunch')).toBeInTheDocument());
  return { host, onChange };
}

/** The value one previewed column renders. */
function previewValue(field: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-lookup-preview="${field}"]`);
  if (!el) throw new Error(`no previewed value for ${field}`);
  return el;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LookupField option preview: a record chip selects its option (objectstack#36479)', () => {
  // Touch (the phone the card was read on) and a mouse (a desktop) take the
  // same path: the defect was the link's click handler, not the pointer.
  it.each(['[TouchA]', '[MouseLeft]'])('%s on the chip selects the option and opens no record', async (keys) => {
    const { host, onChange } = await openPicker(['account']);
    const chip = await waitFor(() => {
      const el = previewValue('account').querySelector<HTMLElement>('[data-record-chip]');
      if (!el) throw new Error('the account column drew no chip');
      return el;
    });
    expect(chip).toHaveTextContent('Fabrikam');

    // No anchor anywhere inside the option: an anchor is a second click
    // target competing with the option's own select.
    const option = screen.getByRole('option');
    expect(option.querySelector('a')).toBeNull();

    const user = userEvent.setup();
    await user.pointer({ keys, target: chip });

    expect(host.openRecord).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe('prj_1');
  });

  it('draws a self-linking column with its text face, so a tap on it selects too', async () => {
    const { onChange } = await openPicker(['contact_email']);
    const value = previewValue('contact_email');
    await waitFor(() => expect(value).toHaveTextContent('pm@fabrikam.example.com'));
    expect(screen.getByRole('option').querySelector('a')).toBeNull();

    const user = userEvent.setup();
    await user.click(value);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe('prj_1');
  });
});

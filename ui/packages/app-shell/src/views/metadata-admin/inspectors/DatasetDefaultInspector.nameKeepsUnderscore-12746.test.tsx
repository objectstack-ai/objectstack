// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12746 — in create mode, the dataset designer's Name keeps every
 * underscore the author types.
 *
 * The same defect, and the same repair, as the report designer's Name
 * (`ReportDefaultInspector.nameKeepsUnderscore-12746.test.tsx`): the box
 * commits on every keystroke and used the strict `toFieldName`, which trims a
 * trailing `_` before the next key arrives. It now commits the prefix-stable
 * `toFieldNameLoose`, as the object designer's Name does, and the Label → Name
 * derivation keeps the strict form.
 *
 * The inspector is rendered with a host double that merges every patch back
 * into the draft, so each keystroke sees the value the last one committed, as
 * in the designer. Keystrokes are real (user-event).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The catalog hooks answer empty, so the inspector renders without a
// MetadataClient or a network; the Name and Label boxes need neither.
vi.mock('./useDatasetFields', () => ({
  useObjectOptions: () => ({ options: [], loading: false }),
  useDatasetFieldCatalog: () => ({ relationships: [], fieldOptions: [], loading: false }),
  useDatasetUsage: () => ({ reports: 0, dashboards: 0, loading: false }),
  fieldTypeToDimensionType: (t: string) => (t === 'date' ? 'date' : 'string'),
}));

import { DatasetDefaultInspector } from './DatasetDefaultInspector';

afterEach(cleanup);

/** The create-mode designer: an empty `name`, and every patch merged back. */
function CreateHost() {
  const [draft, setDraft] = React.useState<Record<string, unknown>>({ dimensions: [], measures: [] });
  return (
    <>
      <DatasetDefaultInspector
        type="dataset"
        name=""
        draft={draft}
        onPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        readOnly={false}
        locale="en-US"
      />
      <output data-testid="draft-name">{typeof draft.name === 'string' ? draft.name : '(absent)'}</output>
    </>
  );
}

const nameBox = () => screen.getByLabelText('Name', { exact: true }) as HTMLInputElement;
const labelBox = () => screen.getByLabelText('Label', { exact: true }) as HTMLInputElement;
const draftName = () => screen.getByTestId('draft-name').textContent;

describe('dataset designer create mode — Name keeps what is typed (objectui#12746)', () => {
  it('Name typed key by key keeps qavrf_rev, in the box and in the draft', async () => {
    const user = userEvent.setup();
    render(<CreateHost />);
    await user.type(nameBox(), 'qavrf_rev');
    expect(nameBox()).toHaveValue('qavrf_rev');
    expect(draftName()).toBe('qavrf_rev');
  });

  it('a cleared Name stays empty and can be typed again', async () => {
    const user = userEvent.setup();
    render(<CreateHost />);
    await user.type(nameBox(), 'sales');
    await user.clear(nameBox());
    expect(nameBox()).toHaveValue('');
    await user.type(nameBox(), 'qavrf_rev');
    expect(nameBox()).toHaveValue('qavrf_rev');
  });

  it('the Label → Name derivation keeps the strict form: no trailing underscore mid-edit, every separator once', async () => {
    const user = userEvent.setup();
    render(<CreateHost />);
    await user.type(labelBox(), 'Revenue -- Board ');
    expect(nameBox()).toHaveValue('revenue_board');
    await user.type(labelBox(), 'Q');
    expect(nameBox()).toHaveValue('revenue_board_q');
  });

  it('a trailing underscore typed onto a derived Name makes it the author\'s: a later Label edit leaves it', async () => {
    const user = userEvent.setup();
    render(<CreateHost />);
    await user.type(labelBox(), 'Qavrf');
    expect(nameBox()).toHaveValue('qavrf');
    await user.type(nameBox(), '_');
    expect(nameBox()).toHaveValue('qavrf_');
    await user.type(labelBox(), ' Board');
    expect(labelBox()).toHaveValue('Qavrf Board');
    expect(nameBox()).toHaveValue('qavrf_');
  });
});

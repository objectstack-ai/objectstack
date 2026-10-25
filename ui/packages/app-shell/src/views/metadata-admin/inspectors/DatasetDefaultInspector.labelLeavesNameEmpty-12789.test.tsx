// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12789 — in create mode, a dataset Label that yields no machine name
 * leaves the Name empty, as the object designer does.
 *
 * The same defect, and the same repair, as the report designer's Label
 * (`ReportDefaultInspector.labelLeavesNameEmpty-12789.test.tsx`): the Label
 * handler derived the Name with `toFieldName`, whose empty result is the
 * placeholder `field`, so a Label in a non-Latin script (`收入`), or a cleared
 * Label, named the dataset `field` without a word. It now derives with
 * `toFieldNameOrEmpty`, the same strict rule with no placeholder, and the
 * comparison that decides whether the Name still follows the Label uses the
 * same function.
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

describe('dataset designer create mode — a Label with no machine name leaves the Name empty (objectui#12789)', () => {
  it('the Label 收入 leaves the Name empty, in the box and in the draft', async () => {
    const user = userEvent.setup();
    render(<CreateHost />);
    await user.type(labelBox(), '收入');
    expect(labelBox()).toHaveValue('收入');
    expect(nameBox()).toHaveValue('');
    expect(draftName()).toBe('');
  });

  it('a cleared Label leaves the Name empty', async () => {
    const user = userEvent.setup();
    render(<CreateHost />);
    await user.type(labelBox(), 'Revenue');
    expect(nameBox()).toHaveValue('revenue');
    await user.clear(labelBox());
    expect(nameBox()).toHaveValue('');
    expect(draftName()).toBe('');
  });

  it('a Name left empty by a non-Latin Label still follows a Latin Label typed later', async () => {
    const user = userEvent.setup();
    render(<CreateHost />);
    await user.type(labelBox(), '收入');
    expect(nameBox()).toHaveValue('');
    await user.clear(labelBox());
    await user.type(labelBox(), 'Revenue Board');
    expect(nameBox()).toHaveValue('revenue_board');
  });

  it('a Name the author typed stays theirs while the Label yields no machine name, even when it reads field', async () => {
    const user = userEvent.setup();
    render(<CreateHost />);
    await user.type(labelBox(), '收入');
    await user.clear(nameBox());
    await user.type(nameBox(), 'field');
    await user.clear(labelBox());
    await user.type(labelBox(), 'Revenue');
    expect(nameBox()).toHaveValue('field');
    expect(draftName()).toBe('field');
  });

  it('a Latin Label still derives the strict form: the f_ prefix, and field from the Label Field', async () => {
    const user = userEvent.setup();
    render(<CreateHost />);
    await user.type(labelBox(), '2024 Revenue');
    expect(nameBox()).toHaveValue('f_2024_revenue');
    await user.clear(labelBox());
    await user.type(labelBox(), 'Field');
    expect(nameBox()).toHaveValue('field');
  });
});

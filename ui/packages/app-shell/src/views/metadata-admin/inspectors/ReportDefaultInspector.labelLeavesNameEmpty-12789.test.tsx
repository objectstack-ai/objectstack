// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12789 — in create mode, a report Label that yields no machine name
 * leaves the Name empty, as the object designer does.
 *
 * The Label handler derived the Name with `toFieldName`, which writes the
 * placeholder `field` when its result is empty. So a Label in a non-Latin
 * script (`收入`), or a cleared Label, named the report `field` without a word,
 * and a second such report collided with the first. The derivation now uses
 * `toFieldNameOrEmpty`, the same strict rule with no placeholder: the Name
 * stays empty and the save path asks the author for one. The comparison that
 * decides whether the Name still follows the Label uses the same function.
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
import { ReportDefaultInspector } from './ReportDefaultInspector';

afterEach(cleanup);

// One fetch double at module scope, never torn down: the inspector's own side
// reads must not reach a socket after a test body returns.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

/** The create-mode designer: an empty `name`, and every patch merged back. */
function CreateHost() {
  const [draft, setDraft] = React.useState<Record<string, unknown>>({ type: 'summary' });
  return (
    <>
      <ReportDefaultInspector
        type="report"
        name=""
        draft={draft}
        onPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        readOnly={false}
        locale="en-US"
        datasetCatalogOverride={[]}
      />
      <output data-testid="draft-name">{typeof draft.name === 'string' ? draft.name : '(absent)'}</output>
    </>
  );
}

const nameBox = () => screen.getByLabelText('Name', { exact: true }) as HTMLInputElement;
const labelBox = () => screen.getByLabelText('Label', { exact: true }) as HTMLInputElement;
const draftName = () => screen.getByTestId('draft-name').textContent;

describe('report designer create mode — a Label with no machine name leaves the Name empty (objectui#12789)', () => {
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

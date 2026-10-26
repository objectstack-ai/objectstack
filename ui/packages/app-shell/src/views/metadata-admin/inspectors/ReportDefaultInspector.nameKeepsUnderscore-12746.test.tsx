// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12746 — in create mode, the report designer's Name keeps every
 * underscore the author types.
 *
 * The Name box commits on every keystroke. It used the strict `toFieldName`,
 * which trims a trailing `_`, so the underscore was gone before the next key
 * arrived: `qavrf_rev` typed key by key read `qavrfrev`, and a report in a
 * namespaced package could not get its prefix by typing. It now commits the
 * prefix-stable `toFieldNameLoose`, as the object designer's Name does. The
 * strict form stays where the object designer keeps its own: the Label → Name
 * derivation, and the comparison that decides whether the Name still follows
 * the Label.
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

describe('report designer create mode — Name keeps what is typed (objectui#12746)', () => {
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
    await user.type(nameBox(), 'pipeline');
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

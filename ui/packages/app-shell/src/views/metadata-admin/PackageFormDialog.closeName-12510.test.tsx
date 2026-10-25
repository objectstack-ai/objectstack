// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12510 — the New package dialog closes through a named button.
 *
 * The 2026-10-15 test pass read the dialog's close button as a button with no
 * name; the browser's computed tree names it "Close" (the dialog primitive's
 * screen-reader label). This pins the name by role, with the dialog's own
 * submit and cancel, so a change that drops that label turns red.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { PackageFormDialog } from './PackageFormDialog';

afterEach(cleanup);

describe('the New package dialog names its controls (objectui#12510)', () => {
  it('the close button is named "Close", beside Cancel and Create package', () => {
    render(<PackageFormDialog mode="create" open onOpenChange={() => {}} onSaved={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /close/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(dialog).getByTestId('package-form-submit')).toHaveAccessibleName('Create package');
  });
});

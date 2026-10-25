/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12986 — `record:quick_actions` maps an action's spec `variant`
 * (`primary | secondary | danger | ghost | link`) onto the `Button`
 * primitive's vocabulary, the way the record header and the row menu do.
 * Unmapped, `danger` and `primary` matched no Button variant and drew
 * unstyled, and a declared `danger` beat the block's `destructive`.
 *
 *  (a) `variant: 'danger'` draws the destructive style;
 *  (b) `variant: 'primary'` draws the default (filled) style;
 *  (c) CONTROL — an action declaring no variant takes the block's `variant`.
 *
 * The style is read from the class the `Button` primitive's cva variant
 * emits (`bg-destructive`, `bg-primary`, `border`), which is what the DOM
 * measurement on the card read.
 */
import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RecordContextProvider } from '@object-ui/react';
import { RecordQuickActionsRenderer } from '../record-quick-actions';

const LABEL = 'Archive';
/** `locations` is not defaulted — `getActionsForLocation` requires the match. */
const ARCHIVE = { name: 'archive', label: LABEL, type: 'script', locations: ['record_header'] };

function mount(action: Record<string, unknown>, blockVariant?: string) {
  return render(
    <RecordContextProvider objectName="sys_environment" recordId="rec-1" data={{ id: 'rec-1' }}>
      <RecordQuickActionsRenderer schema={{ actions: [action], variant: blockVariant } as any} />
    </RecordContextProvider>,
  );
}

const button = () => screen.getByRole('button', { name: LABEL });

describe('record:quick_actions maps an action spec variant onto Button (objectui#12986)', () => {
  it("(a) variant: 'danger' draws the destructive style", () => {
    mount({ ...ARCHIVE, variant: 'danger' }, 'outline');
    expect(button()).toHaveClass('bg-destructive');
    expect(button()).not.toHaveClass('border');
  });

  it("(b) variant: 'primary' draws the default (filled) style", () => {
    mount({ ...ARCHIVE, variant: 'primary' }, 'outline');
    expect(button()).toHaveClass('bg-primary');
    expect(button()).not.toHaveClass('border');
  });

  it("(c) CONTROL: no variant declared → the block's variant", () => {
    mount(ARCHIVE, 'destructive');
    expect(button()).toHaveClass('bg-destructive');
  });
});

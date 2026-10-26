/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8674 — the Field Designer offers no delete action on a system field.
 *
 * ## The card
 *
 * `handleDelete` returned early on `field.isSystem`, before the confirm dialog,
 * while the affordance was wired at the GRID level
 * (`onDelete={readOnly ? undefined : handleDelete}`). `ObjectGrid` derives
 * `{ update: !!onEdit, delete: !!onDelete }` for the whole grid, so the row
 * action was drawn for EVERY row: clicking delete on a system field produced no
 * dialog, no toast and no console message. `readOnly` was already honest in the
 * same component — the operation is withheld, so no button is drawn — and the
 * card's sentence for why that difference is the defect is that the two states
 * "differ in the code and do not differ on screen".
 *
 * ## Why this file renders the REAL `ObjectGrid`
 *
 * Its siblings here mock `@object-ui/plugin-grid` (`__mocks__/plugin-grid`),
 * and that mock draws a delete button for every row whenever `onDelete` is
 * wired — i.e. it reproduces the defect by construction and cannot see the fix.
 * The claim under test is about what the GRID draws for a row, so the grid
 * under test has to be the real one; a stub grid would make this file green
 * against the defect and against the fix alike.
 *
 * ## Every absence is paired with a presence
 *
 * The system row's missing Delete is read next to its surviving Edit (the row
 * still has a menu, and the designer still opens the drawer for system fields —
 * where `name` and `type` are disabled and everything else is editable), and
 * next to the ordinary row that keeps both. A lone `queryBy… === null` would be
 * green if the grid never rendered or the menu never opened.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import type { DesignerFieldDefinition } from '@object-ui/types';
import { ActionProvider } from '@object-ui/react';

import { FieldDesigner } from '../FieldDesigner';
// The REAL record-level explain double and cache reset the grid suites use —
// imported rather than restated, so this file answers that probe the same way
// `plugin-grid`'s own suites do instead of hitting the network under happy-dom.
import { installExplainDouble } from '../../../plugin-grid/src/__tests__/explainDouble';
import { __clearRecordCrudVerdictCache } from '../../../plugin-grid/src/hooks/useRecordCrudVerdicts';

// No `registerAllFields()`: `@object-ui/fields` is not a dependency of this
// package, and nothing here needs a field WIDGET — the assertions read row text
// and the row kebab's entries, both of which the grid renders on its own.

/** An ordinary, author-created field — the presence half of every pair. */
const CUSTOM: DesignerFieldDefinition = {
  id: 'fld_custom',
  name: 'nickname',
  label: 'Nickname',
  type: 'text',
  isSystem: false,
};

/** A system field: the designer may not drop it, and now does not offer to. */
const SYSTEM: DesignerFieldDefinition = {
  id: 'fld_system',
  name: 'created_at',
  label: 'Created At',
  type: 'datetime',
  isSystem: true,
};

const FIELDS = [CUSTOM, SYSTEM];

function renderDesigner(props: Partial<React.ComponentProps<typeof FieldDesigner>> = {}) {
  return render(
    <ActionProvider>
      <FieldDesigner objectName="contacts" fields={FIELDS} onFieldsChange={vi.fn()} {...props} />
    </ActionProvider>,
  );
}

/** What the kebab of the row displaying `label` surfaces. Located by ROW. */
async function rowKebab(label: string): Promise<{ edit: boolean; delete: boolean; trigger: boolean }> {
  const row = screen.getByText(label).closest('tr');
  const trigger = row?.querySelector('[data-testid="row-action-trigger"]');
  if (!trigger) return { edit: false, delete: false, trigger: false };
  await userEvent.click(trigger);
  const answer = {
    edit: screen.queryAllByTestId('row-action-builtin-edit').length > 0,
    delete: screen.queryAllByTestId('row-action-builtin-delete').length > 0,
    trigger: true,
  };
  await userEvent.keyboard('{Escape}');
  return answer;
}

async function settle() {
  await waitFor(() => expect(screen.getByText(SYSTEM.name)).toBeInTheDocument());
}

beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('objectui#8674 · the system field draws no delete action', () => {
  it('withholds Delete on the system row and keeps it on the custom row', async () => {
    // BOTH ARMS in one render. Pre-fix this read `delete: true` on BOTH rows
    // and the system row's click did nothing at all.
    renderDesigner();
    await settle();

    expect(await rowKebab(SYSTEM.name)).toEqual({ edit: true, delete: false, trigger: true });
    expect(await rowKebab(CUSTOM.name)).toEqual({ edit: true, delete: true, trigger: true });
  });

  it('keeps the system row editable — the drawer still opens, it is only delete that is refused', async () => {
    // The narrowing is `delete` only. `isSystem` disables `name` and `type`
    // inside the drawer form; it has never meant "this row is untouchable", and
    // a fix that withheld Edit too would be a capability regression wearing a
    // bug fix's clothes.
    renderDesigner();
    await settle();

    const row = screen.getByText(SYSTEM.name).closest('tr');
    await userEvent.click(row!.querySelector('[data-testid="row-action-trigger"]')!);
    await userEvent.click(screen.getAllByTestId('row-action-builtin-edit')[0]);

    await waitFor(() => expect(screen.getByDisplayValue(SYSTEM.label)).toBeInTheDocument());
  });

  it('readOnly stays honest: no row actions at all, for either kind of field', async () => {
    // The state the card called the honest one, unchanged by this fix.
    renderDesigner({ readOnly: true });
    await settle();

    expect(await rowKebab(SYSTEM.name)).toEqual({ edit: false, delete: false, trigger: false });
    expect(await rowKebab(CUSTOM.name)).toEqual({ edit: false, delete: false, trigger: false });
  });
});

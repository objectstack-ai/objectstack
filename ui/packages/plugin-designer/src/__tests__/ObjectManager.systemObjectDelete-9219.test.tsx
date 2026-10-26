/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9219 — the Object Manager offers no delete action on a system
 * object. objectui#8674's defect, one component over.
 *
 * ## The card
 *
 * `handleDelete` returned early on `obj.isSystem`, before the confirm dialog,
 * while the affordance was wired at the GRID level
 * (`onDelete={readOnly ? undefined : handleDelete}`) — one callback, drawn for
 * every row. So a system-object row carried a delete entry whose click
 * produced no dialog, no toast and no console message. `readOnly` was honest
 * in the same component (the callback is withheld, so nothing is drawn);
 * `isSystem` drew the entry and swallowed the click. Two states that differ in
 * the code and do not differ on screen.
 *
 * The row is reachable by DEFAULT: `showSystemObjects` defaults to true and
 * `displayObjects` filters system objects out only when it is false — pinned
 * next door by `ObjectManager.test.tsx`'s *should show system objects by
 * default*. The first assertion below re-reads that default from this file, so
 * the two arms that follow are known to be about a row that is actually on
 * screen.
 *
 * ## ⚠️ Why this file renders the REAL `ObjectGrid`
 *
 * `ObjectManager.test.tsx` mounts `__mocks__/plugin-grid`, and that double
 * draws a delete button for every row whenever `onDelete` is wired while
 * knowing nothing about `rowOperations`. It therefore reproduces this defect by
 * construction and is structurally blind to the repair: a pin written against
 * it is green whether or not the fix lands. The claim under test is about what
 * the GRID draws for a row, so the grid under test has to be the real one.
 *
 * Teaching the double the prop was the other admissible route. It was not
 * taken: the semantics being asserted are the grid's intersection rules — only
 * an explicit `false` removes, `null` / `undefined` / `{}` mean "no opinion" —
 * and a hand-written second copy of those rules in a stub is free to drift away
 * from the one `packages/plugin-grid` actually ships. `plugin-grid`'s own
 * `rowOperationsPerRow-8674.test.tsx` pins the rules; this file pins that
 * `ObjectManager` speaks them, through the same component a user sees. The
 * sibling repair set the same precedent in
 * `FieldDesigner.systemFieldDelete-8674.test.tsx`, whose shape this file
 * follows deliberately.
 *
 * ## Every absence is paired with a presence
 *
 * The system row's missing Delete is read next to its surviving Edit, and next
 * to the custom row that keeps both — in the SAME render. A lone
 * `queryBy… === null` would be equally green if the grid never rendered, the
 * row were addressed wrongly, or the menu never opened.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import type { ObjectDefinition } from '@object-ui/types';
import { ActionProvider } from '@object-ui/react';

import { ObjectManager } from '../ObjectManager';
// The REAL record-level explain double and cache reset the grid suites use —
// imported rather than restated, so this file answers that probe the same way
// `plugin-grid`'s own suites do instead of hitting the network under happy-dom.
import { installExplainDouble } from '../../../plugin-grid/src/__tests__/explainDouble';
import { __clearRecordCrudVerdictCache } from '../../../plugin-grid/src/hooks/useRecordCrudVerdicts';

// No `registerAllFields()`: `@object-ui/fields` is not a dependency of this
// package, and nothing here needs a field WIDGET — the assertions read row text
// and the row kebab's entries, both of which the grid renders on its own.

/** An ordinary, author-created object — the presence half of every pair. */
const CUSTOM: ObjectDefinition = {
  id: 'obj_custom',
  name: 'accounts',
  label: 'Accounts',
  group: 'Custom Objects',
  isSystem: false,
  fieldCount: 12,
};

/** A system object: the designer may not drop it, and now does not offer to. */
const SYSTEM: ObjectDefinition = {
  id: 'obj_system',
  name: 'users',
  label: 'Users',
  group: 'System Objects',
  isSystem: true,
  fieldCount: 5,
};

const OBJECTS = [CUSTOM, SYSTEM];

function renderManager(props: Partial<React.ComponentProps<typeof ObjectManager>> = {}) {
  return render(
    <ActionProvider>
      <ObjectManager objects={OBJECTS} onObjectsChange={vi.fn()} {...props} />
    </ActionProvider>,
  );
}

/**
 * What the kebab of the row displaying `name` surfaces.
 *
 * Located by ROW rather than by index: a row whose entries are all hidden grows
 * no "⋮" trigger at all (#3562), so indexing into `queryAllByTestId` would
 * silently address a different row as soon as the gating works.
 */
async function rowKebab(name: string): Promise<{ edit: boolean; delete: boolean; trigger: boolean }> {
  const row = screen.getByText(name).closest('tr');
  const trigger = row?.querySelector('[data-testid="row-action-trigger"]');
  if (!trigger) return { edit: false, delete: false, trigger: false };
  await userEvent.click(trigger);
  const answer = {
    edit: screen.queryAllByTestId('row-action-builtin-edit').length > 0,
    delete: screen.queryAllByTestId('row-action-builtin-delete').length > 0,
    trigger: true,
  };
  // Close the (portalled) menu so the next row's read sees only its own items.
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

describe('objectui#9219 · the system object draws no delete action', () => {
  it('withholds Delete on the system row and keeps it on the custom row, at the default visibility', async () => {
    // BOTH ARMS in one render, and no `showSystemObjects` prop — the state the
    // card is about is the DEFAULT one. Pre-fix this read `delete: true` on
    // both rows and the system row's click did nothing at all.
    renderManager();
    await settle();

    // The premise, read here rather than borrowed: the system row IS on screen
    // without anyone asking for it.
    expect(screen.getByText(SYSTEM.name)).toBeInTheDocument();
    expect(screen.getByText(CUSTOM.name)).toBeInTheDocument();

    expect(await rowKebab(SYSTEM.name)).toEqual({ edit: true, delete: false, trigger: true });
    expect(await rowKebab(CUSTOM.name)).toEqual({ edit: true, delete: true, trigger: true });
  });

  it('keeps the system row editable — the modal still opens, it is only delete that is refused', async () => {
    // The narrowing is `delete` only. `isSystem` disables the `name` input
    // inside the form; it has never meant "this row is untouchable", and a fix
    // that withheld Edit too would be a capability regression wearing a bug
    // fix's clothes.
    renderManager();
    await settle();

    const row = screen.getByText(SYSTEM.name).closest('tr');
    await userEvent.click(row!.querySelector('[data-testid="row-action-trigger"]')!);
    await userEvent.click(screen.getAllByTestId('row-action-builtin-edit')[0]);

    await waitFor(() => expect(screen.getByDisplayValue(SYSTEM.label)).toBeInTheDocument());
  });

  it('readOnly stays honest: no row actions at all, for either kind of object', async () => {
    // The state the card called the honest one, unchanged by this fix.
    renderManager({ readOnly: true });
    await settle();

    expect(await rowKebab(SYSTEM.name)).toEqual({ edit: false, delete: false, trigger: false });
    expect(await rowKebab(CUSTOM.name)).toEqual({ edit: false, delete: false, trigger: false });
  });
});

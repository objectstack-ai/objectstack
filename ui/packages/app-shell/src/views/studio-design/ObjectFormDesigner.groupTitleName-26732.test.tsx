// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26732 — the form designer's inline group-title input has an
 * accessible name.
 *
 * Before: a declared group's header held a bare `<input>` with no label, no
 * `aria-label` and no `id`, so a screen reader announced an unnamed edit field.
 * There is no visible label beside it, so it names itself with the label the
 * group inspector gives the same value (`engine.studio.designer.group.nameLabel`).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ObjectFormDesigner } from './ObjectFormDesigner';
import { t } from '../metadata-admin/i18n';

afterEach(cleanup);

const draft = {
  name: 'crm_account',
  fields: [{ name: 'name', type: 'text', label: 'Account Name', group: 'basic' }],
  fieldGroups: [{ key: 'basic', label: 'Basic Information' }],
};

describe('objectstack#26732 — the form designer names its group-title input', () => {
  it("a declared group's title input is found by its name and holds the group's label", () => {
    render(
      <ObjectFormDesigner
        draft={draft}
        systemFieldNames={new Set()}
        onChange={vi.fn()}
        onSelectField={() => {}}
        onSelectGroup={() => {}}
      />,
    );
    const input = screen.getByRole('textbox', { name: t('engine.studio.designer.group.nameLabel', 'en-US') });
    expect(input).toHaveValue('Basic Information');
  });
});

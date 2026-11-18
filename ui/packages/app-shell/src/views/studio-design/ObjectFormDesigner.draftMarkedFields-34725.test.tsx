// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34725 item 7 — the form canvas marks the fields the AI assistant
 * changed in the pending draft: a 草稿 chip after the field card's label, for
 * the names the Data pillar hands in `draftMarkedFields`, and on no other card.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ObjectFormDesigner } from './ObjectFormDesigner';
import { t } from '../metadata-admin/i18n';

afterEach(cleanup);

const draft = {
  name: 'hcpl_borrowing',
  fields: [
    { name: 'title', type: 'text', label: 'Title' },
    { name: 'renew_count', type: 'number', label: 'Renewals' },
  ],
};

function renderDesigner(draftMarkedFields?: ReadonlySet<string>) {
  render(
    <ObjectFormDesigner
      draft={draft}
      systemFieldNames={new Set()}
      onChange={vi.fn()}
      onSelectField={() => {}}
      onSelectGroup={() => {}}
      draftMarkedFields={draftMarkedFields}
    />,
  );
}

describe('the form designer marks the AI assistant’s draft fields (objectstack#34725)', () => {
  it('a marked field card carries the 草稿 chip; the others do not', () => {
    renderDesigner(new Set(['renew_count']));
    const chips = screen.getAllByTestId('studio-form-field-draft-chip');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveAttribute('data-draft-of', 'renew_count');
    expect(chips[0]).toHaveTextContent(t('engine.studio.draftMark.chip', 'en-US'));
  });

  it('with no marked fields, no chips', () => {
    renderDesigner();
    expect(screen.queryByTestId('studio-form-field-draft-chip')).toBeNull();
  });
});

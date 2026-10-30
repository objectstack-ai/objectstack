// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27837 — the formula field's "Formula (CEL)" editor offers the
 * object's other fields by label, and inserting one writes its CEL reference
 * (`record.<name>`) into the field's `expression`. The field being edited is
 * not offered: a formula may not reference itself.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({
    list: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
  }),
}));

import { ObjectFieldInspector } from './ObjectFieldInspector';

type Row = Record<string, unknown>;

afterEach(cleanup);

const OBJECT: Row = {
  name: 'project_task',
  label: 'Task',
  fields: {
    name: { type: 'text', label: 'Name' },
    estimated_hours: { type: 'number', label: 'Estimated Hours' },
    // No label: the picker shows the name.
    hourly_rate: { type: 'currency' },
    est_cost: { type: 'formula', label: 'Estimated Cost', expression: '' },
  },
};

function Designer({ drafts }: { drafts: Row[] }) {
  const [draft, setDraft] = React.useState<Row>(OBJECT);
  return (
    <ObjectFieldInspector
      type="object"
      name="project_task"
      draft={draft}
      selection={{ kind: 'field', id: 'est_cost' }}
      onPatch={(patch: Row) => {
        setDraft((d) => {
          const next = { ...d, ...patch };
          drafts.push(next);
          return next;
        });
      }}
      onClearSelection={() => {}}
      onSelectionChange={() => {}}
      readOnly={false}
      locale={'en-US'}
    />
  );
}

describe('the formula editor inserts a sibling field by label (objectstack#27837)', () => {
  it('offers every other field by its label, and writes record.<name> into expression', async () => {
    const user = userEvent.setup();
    const drafts: Row[] = [];
    render(<Designer drafts={drafts} />);
    await user.click(screen.getByTestId('cel-insert-field'));

    const options = await screen.findAllByRole('option');
    const offered = options.map((o) => o.getAttribute('data-field-name'));
    expect(offered).toEqual(['name', 'estimated_hours', 'hourly_rate']);
    expect(screen.getByRole('option', { name: /Estimated Hours/ })).toBeTruthy();

    await user.click(screen.getByRole('option', { name: /Estimated Hours/ }));
    const last = drafts[drafts.length - 1] as { fields: Record<string, Row> } | undefined;
    const fields = last?.fields as unknown;
    const est = Array.isArray(fields)
      ? (fields as Row[]).find((f) => f.name === 'est_cost')
      : (fields as Record<string, Row>)?.est_cost;
    expect(est?.expression).toBe('record.estimated_hours');
  });
});

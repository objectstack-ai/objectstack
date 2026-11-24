// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36219] The field inspector's CEL editors hand the lint the object's field
 * types and `multiple`, so `record.<list field> == 'a'` — a list compared with
 * a scalar, one constant on every row — is refused (`list-equality`) while the
 * author types, as the object draft check refuses it on save. A `select`
 * declared `multiple: true` is the list subject; a plain `select` is the
 * scalar control. Against the REAL `@objectstack/formula` engine.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
// The CEL authoring helpers load these through dynamic imports; paying the first
// load at module top keeps it out of every clocked window (`check:test-source-alias`).
import '@objectstack/formula';
import '@objectstack/lint';

vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({
    list: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { ObjectFieldInspector } from './ObjectFieldInspector';

afterEach(cleanup);

const OPTIONS = [
  { label: 'Frontend', value: 'frontend' },
  { label: 'QA', value: 'qa' },
];

function Harness({ onBlockingIssuesChange }: { onBlockingIssuesChange: (count: number) => void }) {
  const [fields, setFields] = React.useState<Record<string, Record<string, unknown>>>({
    stage: { type: 'select', label: 'Stage', options: OPTIONS, multiple: true },
    single: { type: 'select', label: 'Single', options: OPTIONS },
    note: { type: 'text', label: 'Note' },
  });
  return (
    <ObjectFieldInspector
      type="object"
      name="ticket"
      draft={{ name: 'ticket', fields }}
      selection={{ kind: 'field', id: 'note' }}
      onPatch={(patch: Record<string, unknown>) => setFields(patch.fields as typeof fields)}
      onClearSelection={() => {}}
      onSelectionChange={() => {}}
      readOnly={false}
      locale={'en-US'}
      onBlockingIssuesChange={onBlockingIssuesChange}
    />
  );
}

function typeVisibleWhen(source: string) {
  const report = vi.fn();
  render(<Harness onBlockingIssuesChange={report} />);
  const box = screen.getByText('Visible when').parentElement!.querySelector('textarea') as HTMLElement;
  fireEvent.change(box, { target: { value: source } });
  return () => report.mock.calls.at(-1)?.[0] as number | undefined;
}

describe('ObjectFieldInspector — list-equality while typing (#36219)', () => {
  it('refuses == on a select declared multiple: true, and holds Save', async () => {
    const current = typeVisibleWhen("record.stage == 'qa'");
    await waitFor(() => expect(current()).toBe(1), { timeout: 5000 });
    expect(await screen.findByText(/`record\.stage` holds a list/)).toBeInTheDocument();
  });

  it('CONTROL — the same comparison on a scalar select is clean', async () => {
    const current = typeVisibleWhen("record.single == 'qa'");
    await waitFor(() => expect(current()).toBe(0), { timeout: 5000 });
    expect(screen.queryByText(/holds a list/)).toBeNull();
  });
});

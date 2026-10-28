// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0015 external objects in the object designer: every field says which
 * datasource it comes from and whether it can be written, and no control that
 * would reshape the remote table is offered — add field (canvas, section,
 * empty state), bulk delete, and in the field inspector rename, retype,
 * duplicate and remove. A platform-owned object keeps every one of them.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';

const metaGet = vi.fn();
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({
    get: metaGet,
    list: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
  }),
}));
vi.mock('../../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
}));

import { ObjectFormCanvas } from './ObjectFormCanvas';
import { ObjectFieldInspector } from '../inspectors/ObjectFieldInspector';
import { readExternalBinding } from './external-object';

// The zh rows are read synchronously below; the catalogue is fetched on demand.
await loadStudioCatalogue('zh');

beforeEach(() => metaGet.mockReset());
afterEach(cleanup);

const FIELDS = {
  task_name: { type: 'text', label: 'Task name' },
  start_date: { type: 'date', label: 'Start' },
};

function externalDraft(external: Record<string, unknown> = {}) {
  return { name: 'gantt_task', datasource: 'plan_gantt', external, fields: FIELDS };
}

describe('readExternalBinding', () => {
  it('is present exactly when the object carries an external binding', () => {
    expect(readExternalBinding({ name: 'account', fields: FIELDS })).toBeNull();
    expect(readExternalBinding(externalDraft())).toEqual({ datasource: 'plan_gantt', writable: false });
    expect(readExternalBinding(externalDraft({ writable: true }))).toEqual({
      datasource: 'plan_gantt',
      writable: true,
    });
  });
});

describe('ObjectFormCanvas — external object', () => {
  it('marks every field with its datasource and read-only state, and offers no Add field', () => {
    render(<ObjectFormCanvas objectName="gantt_task" draft={externalDraft()} onPatch={vi.fn()} />);
    const badges = screen.getAllByTestId('external-field-badge');
    // One in the header note, one per field.
    expect(badges).toHaveLength(3);
    for (const b of badges) expect(b).toHaveTextContent('From plan_gantt · Read-only');
    expect(screen.getByTestId('external-object-notice')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add field/ })).toBeNull();
    // A writable: false object never asks the datasource.
    expect(metaGet).not.toHaveBeenCalled();
  });

  it('reads the mark in Chinese: 来自 plan_gantt · 只读', () => {
    render(
      <ObjectFormCanvas objectName="gantt_task" draft={externalDraft()} onPatch={vi.fn()} locale="zh-CN" />,
    );
    expect(screen.getAllByTestId('external-field-badge')[1]).toHaveTextContent('来自 plan_gantt · 只读');
    expect(screen.queryByRole('button', { name: /添加字段/ })).toBeNull();
  });

  it('offers no Add field on an external object with no fields, nor on a section header', () => {
    const { unmount } = render(
      <ObjectFormCanvas
        objectName="gantt_task"
        draft={{ ...externalDraft(), fields: {} }}
        onPatch={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /Add field/ })).toBeNull();
    unmount();
    render(
      <ObjectFormCanvas
        objectName="gantt_task"
        draft={{
          ...externalDraft(),
          fields: { task_name: { type: 'text', label: 'Task name', group: 'main' } },
          fieldGroups: [{ key: 'main', label: 'Main' }],
        }}
        onPatch={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Add field to this section' })).toBeNull();
  });

  it('keeps bulk move but drops bulk delete', () => {
    render(<ObjectFormCanvas objectName="gantt_task" draft={externalDraft()} onPatch={vi.fn()} />);
    fireEvent.click(screen.getByText('Task name').closest('[role="button"]')!, { ctrlKey: true });
    expect(screen.getByText(/1 selected/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull();
  });

  it('a platform-owned object keeps Add field and shows no source mark (control)', () => {
    render(<ObjectFormCanvas objectName="account" draft={{ name: 'account', fields: FIELDS }} onPatch={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Add field/ })).toBeInTheDocument();
    expect(screen.queryByTestId('external-field-badge')).toBeNull();
    fireEvent.click(screen.getByText('Task name').closest('[role="button"]')!, { ctrlKey: true });
    expect(screen.getByRole('button', { name: /^Delete/ })).toBeInTheDocument();
  });

  it('writable: true reads the datasource — allowWrites settles it as Writable', async () => {
    metaGet.mockResolvedValue({ name: 'plan_gantt', external: { allowWrites: true } });
    render(
      <ObjectFormCanvas objectName="gantt_task" draft={externalDraft({ writable: true })} onPatch={vi.fn()} />,
    );
    expect(metaGet).toHaveBeenCalledWith('datasource', 'plan_gantt');
    await waitFor(() =>
      expect(screen.getAllByTestId('external-field-badge')[0]).toHaveTextContent('From plan_gantt · Writable'),
    );
  });

  it('writable: true on a datasource without allowWrites is Read-only', async () => {
    metaGet.mockResolvedValue({ name: 'plan_gantt', external: {} });
    render(
      <ObjectFormCanvas objectName="gantt_task" draft={externalDraft({ writable: true })} onPatch={vi.fn()} />,
    );
    await waitFor(() =>
      expect(screen.getAllByTestId('external-field-badge')[0]).toHaveAttribute('data-write-state', 'read-only'),
    );
  });

  it('a datasource read that fails is shown as unconfirmed, never guessed', async () => {
    metaGet.mockRejectedValue(new Error('403'));
    render(
      <ObjectFormCanvas objectName="gantt_task" draft={externalDraft({ writable: true })} onPatch={vi.fn()} />,
    );
    await waitFor(() => expect(metaGet).toHaveBeenCalled());
    const badge = screen.getAllByTestId('external-field-badge')[0];
    expect(badge).toHaveAttribute('data-write-state', 'unconfirmed');
    expect(badge).toHaveTextContent('From plan_gantt · Writes unconfirmed');
  });
});

describe('ObjectFieldInspector — field of an external object', () => {
  function renderInspector(draft: Record<string, unknown>) {
    return render(
      <ObjectFieldInspector
        type="object"
        name={String(draft.name)}
        draft={draft}
        selection={{ kind: 'field', id: 'task_name' }}
        onPatch={vi.fn()}
        onClearSelection={vi.fn()}
        onSelectionChange={vi.fn()}
        readOnly={false}
        locale={'en-US'}
      />,
    );
  }

  it('shows the source mark and offers no rename, retype, duplicate or remove', () => {
    renderInspector(externalDraft());
    expect(screen.getByTestId('external-field-badge')).toHaveTextContent('From plan_gantt · Read-only');
    expect(screen.getByTestId('field-apiname-input')).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Type' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Duplicate field' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    // Label is display metadata, not the remote column: it stays editable.
    expect(screen.getByTestId('field-label-input')).not.toBeDisabled();
  });

  it('a platform-owned object keeps all four (control)', () => {
    renderInspector({ name: 'account', fields: FIELDS });
    expect(screen.queryByTestId('external-field-badge')).toBeNull();
    expect(screen.getByTestId('field-apiname-input')).not.toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Type' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Duplicate field' })).toBeInTheDocument();
    const footer = screen.getByRole('button', { name: /Remove/ });
    expect(within(footer).getByText(/Task name/)).toBeInTheDocument();
  });
});

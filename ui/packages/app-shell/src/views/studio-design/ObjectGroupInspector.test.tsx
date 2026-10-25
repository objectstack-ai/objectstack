// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ObjectGroupInspector } from './ObjectGroupInspector';

const draftWith = (group: Record<string, unknown>) => ({ fieldGroups: [group] });

describe('ObjectGroupInspector', () => {
  it('renders the group name and edits it via onPatch, preserving other props', () => {
    const onPatch = vi.fn();
    render(
      <ObjectGroupInspector
        draft={draftWith({ key: 'billing', label: 'Billing', collapse: 'collapsed' })}
        groupKey="billing"
        onPatch={onPatch}
        onClose={() => {}}
      />,
    );
    const input = screen.getByTestId('group-label') as HTMLInputElement;
    expect(input.value).toBe('Billing');

    fireEvent.change(input, { target: { value: 'Billing & Tax' } });
    const patch = onPatch.mock.calls[0][0];
    // Renaming through the inspector must not wipe the collapse setting.
    expect(patch.fieldGroups[0]).toEqual({ key: 'billing', label: 'Billing & Tax', collapse: 'collapsed' });
  });

  it('surfaces the collapse control and its hint', () => {
    render(
      <ObjectGroupInspector
        draft={draftWith({ key: 'billing', label: 'Billing' })}
        groupKey="billing"
        onPatch={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Collapse behavior')).toBeTruthy();
    expect(screen.getByText(/actual form/i)).toBeTruthy();
  });

  it('shows an empty state when the group no longer exists', () => {
    render(
      <ObjectGroupInspector
        draft={draftWith({ key: 'billing', label: 'Billing' })}
        groupKey="ghost"
        onPatch={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('This group no longer exists.')).toBeTruthy();
  });

  it('disables editing when readOnly', () => {
    render(
      <ObjectGroupInspector
        draft={draftWith({ key: 'billing', label: 'Billing' })}
        groupKey="billing"
        onPatch={() => {}}
        onClose={() => {}}
        readOnly
      />,
    );
    expect((screen.getByTestId('group-label') as HTMLInputElement).disabled).toBe(true);
  });
});

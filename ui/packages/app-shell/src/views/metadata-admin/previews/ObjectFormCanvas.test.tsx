// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { ObjectFormCanvas } from './ObjectFormCanvas';
import { assistantBus } from '../../../assistant/assistantBus';
import { useAiSurfaceEnabled } from '../../../hooks/useAiSurface';

// The designer's "Ask AI" affordances are runtime-gated on the shared
// AI-surface signal. Mock it so both states can be exercised without standing
// up a discovery data source; every test starts with AI enabled (see
// beforeEach), and the Community-Edition case overrides it to disabled.
vi.mock('../../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: vi.fn(() => ({ enabled: true, isLoading: false })),
}));

beforeEach(() => {
  vi.mocked(useAiSurfaceEnabled).mockReturnValue({ enabled: true, isLoading: false });
});
afterEach(cleanup);

/* shared fixtures for the review/diff tests */
const REVIEW_BASELINE = {
  name: 'account',
  fields: {
    name: { type: 'text', label: 'Name' },
    legacy: { type: 'text', label: 'Legacy' },
  },
};
const REVIEW_DRAFT = {
  name: 'account',
  fields: {
    name: { type: 'text', label: 'Full Name' }, // changed (label)
    phone: { type: 'phone', label: 'Mobile' }, // added (label ≠ type, avoids badge clash)
    // legacy removed
  },
};

/** Draft with three fields, two declared sections (one empty). */
function draftWithGroups() {
  return {
    name: 'account',
    fields: {
      first_name: { type: 'text', label: 'First Name', group: 'profile', required: true },
      email: { type: 'email', label: 'Email', group: 'profile' },
      notes: { type: 'textarea', label: 'Notes' }, // ungrouped
    },
    fieldGroups: [
      { key: 'profile', label: 'Profile' },
      { key: 'meta', label: 'Metadata' }, // declared but empty
    ],
  };
}

describe('ObjectFormCanvas — review toolbar', () => {
  it('summarizes field / required / section counts', () => {
    const { container } = render(
      <ObjectFormCanvas objectName="account" draft={draftWithGroups()} onPatch={vi.fn()} />,
    );
    // 3 fields · 1 required · 2 sections
    const text = container.textContent ?? '';
    expect(text).toMatch(/3\s*fields/);
    expect(text).toMatch(/1\s*required/);
    expect(text).toMatch(/2\s*sections/);
  });
});

describe('ObjectFormCanvas — section rendering', () => {
  it('renders declared sections (incl. empty) while editing, with the empty-section hint', () => {
    render(<ObjectFormCanvas objectName="account" draft={draftWithGroups()} onPatch={vi.fn()} />);
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('Metadata')).toBeInTheDocument();
    expect(screen.getByText('Ungrouped')).toBeInTheDocument();
    // The empty "Metadata" section advertises itself as a drop target.
    expect(screen.getByText('Drag fields here, or add one below')).toBeInTheDocument();
  });

  it('hides the empty-declared section and group chrome when read-only (no onPatch)', () => {
    render(<ObjectFormCanvas objectName="account" draft={draftWithGroups()} />);
    expect(screen.getByText('Profile')).toBeInTheDocument();
    // Empty declared group is dropped in read-only mode.
    expect(screen.queryByText('Metadata')).not.toBeInTheDocument();
    // No authoring affordances.
    expect(screen.queryByText('Add section')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove section' })).not.toBeInTheDocument();
  });

  it('renders a flat list (no headers) when no groups are declared', () => {
    const draft = { name: 'x', fields: { a: { type: 'text', label: 'A' } } };
    render(<ObjectFormCanvas objectName="x" draft={draft} onPatch={vi.fn()} />);
    expect(screen.queryByText('Ungrouped')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Collapse section' })).not.toBeInTheDocument();
  });
});

describe('ObjectFormCanvas — section operations', () => {
  it('Add section appends a new fieldGroup via onPatch', () => {
    const onPatch = vi.fn();
    render(<ObjectFormCanvas objectName="account" draft={draftWithGroups()} onPatch={onPatch} />);
    fireEvent.click(screen.getByText('Add section'));
    expect(onPatch).toHaveBeenCalledTimes(1);
    const patch = onPatch.mock.calls[0][0];
    expect(patch.fieldGroups).toHaveLength(3);
    expect(patch.fieldGroups[2]).toMatchObject({ label: 'Section 3' });
  });

  it('Remove section drops the group AND clears member fields’ group', () => {
    const onPatch = vi.fn();
    render(<ObjectFormCanvas objectName="account" draft={draftWithGroups()} onPatch={onPatch} />);
    // Profile is the first removable section.
    const removeBtns = screen.getAllByRole('button', { name: 'Remove section' });
    fireEvent.click(removeBtns[0]);
    const patch = onPatch.mock.calls[0][0];
    expect(patch.fieldGroups.map((g: any) => g.key)).toEqual(['meta']);
    // first_name / email lose their group; fields payload is a record (input shape).
    expect(patch.fields.first_name.group).toBeUndefined();
    expect(patch.fields.email.group).toBeUndefined();
    expect(patch.fields.notes).toBeDefined();
  });

  it('move-up is disabled for the first section, enabled for later ones', () => {
    const onPatch = vi.fn();
    render(<ObjectFormCanvas objectName="account" draft={draftWithGroups()} onPatch={onPatch} />);
    const upButtons = screen.getAllByRole('button', { name: 'Move section up' });
    // First declared group (Profile) cannot move up.
    expect(upButtons[0]).toBeDisabled();
    // Second declared group (Metadata) can.
    expect(upButtons[1]).not.toBeDisabled();
    fireEvent.click(upButtons[1]);
    expect(onPatch.mock.calls[0][0].fieldGroups.map((g: any) => g.key)).toEqual(['meta', 'profile']);
  });
});

describe('ObjectFormCanvas — collapse', () => {
  it('collapsing a section hides its field rows', () => {
    render(<ObjectFormCanvas objectName="account" draft={draftWithGroups()} onPatch={vi.fn()} />);
    expect(screen.getByText('First Name')).toBeInTheDocument();
    const collapseButtons = screen.getAllByRole('button', { name: 'Collapse section' });
    fireEvent.click(collapseButtons[0]); // collapse Profile
    expect(screen.queryByText('First Name')).not.toBeInTheDocument();
    // Header stays.
    expect(screen.getByText('Profile')).toBeInTheDocument();
  });

  it('Collapse all toggles every section, then Expand all restores them', () => {
    render(<ObjectFormCanvas objectName="account" draft={draftWithGroups()} onPatch={vi.fn()} />);
    fireEvent.click(screen.getByText('Collapse all'));
    expect(screen.queryByText('First Name')).not.toBeInTheDocument();
    expect(screen.queryByText('Notes')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Expand all'));
    expect(screen.getByText('First Name')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });
});

describe('ObjectFormCanvas — inline section rename', () => {
  it('commits a renamed section label via onPatch', () => {
    const onPatch = vi.fn();
    render(<ObjectFormCanvas objectName="account" draft={draftWithGroups()} onPatch={onPatch} />);
    fireEvent.doubleClick(screen.getByText('Profile'));
    const input = screen.getByDisplayValue('Profile') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Contact' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const patch = onPatch.mock.calls.at(-1)![0];
    expect(patch.fieldGroups.find((g: any) => g.key === 'profile').label).toBe('Contact');
  });
});

describe('ObjectFormCanvas — empty state', () => {
  it('shows the empty canvas + a single Add field affordance', () => {
    render(<ObjectFormCanvas objectName="x" draft={{ name: 'x', fields: {} }} onPatch={vi.fn()} />);
    expect(screen.getByText('No fields yet')).toBeInTheDocument();
    // No toolbar / sections when there are zero fields.
    expect(screen.queryByText('fields')).not.toBeInTheDocument();
  });
});

describe('ObjectFormCanvas — keyboard reorder (Alt+↑/↓)', () => {
  const draft = {
    name: 'x',
    fields: {
      alpha: { type: 'text', label: 'Alpha' },
      beta: { type: 'text', label: 'Beta' },
    },
  };
  const rowFor = (label: string) => screen.getByText(label).closest('[role="button"]')!;

  it('Alt+ArrowDown swaps a field with the next one', () => {
    const onPatch = vi.fn();
    render(<ObjectFormCanvas objectName="x" draft={draft} onPatch={onPatch} />);
    fireEvent.keyDown(rowFor('Alpha'), { key: 'ArrowDown', altKey: true });
    const patch = onPatch.mock.calls.at(-1)![0];
    expect(Object.keys(patch.fields)).toEqual(['beta', 'alpha']);
  });

  it('Alt+ArrowUp on the first field is a no-op', () => {
    const onPatch = vi.fn();
    render(<ObjectFormCanvas objectName="x" draft={draft} onPatch={onPatch} />);
    fireEvent.keyDown(rowFor('Alpha'), { key: 'ArrowUp', altKey: true });
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('plain ArrowDown (no Alt) does not reorder', () => {
    const onPatch = vi.fn();
    render(<ObjectFormCanvas objectName="x" draft={draft} onPatch={onPatch} />);
    fireEvent.keyDown(rowFor('Alpha'), { key: 'ArrowDown' });
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('is inert when read-only (no onPatch)', () => {
    render(<ObjectFormCanvas objectName="x" draft={draft} />);
    // No throw, and the row is not draggable/reorderable.
    fireEvent.keyDown(rowFor('Alpha'), { key: 'ArrowDown', altKey: true });
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });
});

describe('ObjectFormCanvas — bulk multi-select', () => {
  const flat = {
    name: 'x',
    fields: {
      a: { type: 'text', label: 'A' },
      b: { type: 'text', label: 'B' },
      c: { type: 'text', label: 'C' },
    },
  };
  const rowFor = (label: string) => screen.getByText(label).closest('[role="button"]')!;

  it('Ctrl-click enters multi-select and shows the bulk bar', () => {
    render(<ObjectFormCanvas objectName="x" draft={flat} onPatch={vi.fn()} onSelectionChange={vi.fn()} />);
    fireEvent.click(rowFor('A'), { ctrlKey: true });
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    fireEvent.click(rowFor('B'), { ctrlKey: true });
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('bulk delete removes every selected field', () => {
    const onPatch = vi.fn();
    render(<ObjectFormCanvas objectName="x" draft={flat} onPatch={onPatch} onSelectionChange={vi.fn()} />);
    fireEvent.click(rowFor('A'), { ctrlKey: true });
    fireEvent.click(rowFor('B'), { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(Object.keys(onPatch.mock.calls.at(-1)![0].fields)).toEqual(['c']);
  });

  it('Shift-click selects a contiguous range', () => {
    render(<ObjectFormCanvas objectName="x" draft={flat} onPatch={vi.fn()} onSelectionChange={vi.fn()} />);
    fireEvent.click(rowFor('A')); // plain click → anchor
    fireEvent.click(rowFor('C'), { shiftKey: true });
    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });

  it('a plain click clears the multi-selection and single-selects', () => {
    const onSelectionChange = vi.fn();
    render(<ObjectFormCanvas objectName="x" draft={flat} onPatch={vi.fn()} onSelectionChange={onSelectionChange} />);
    fireEvent.click(rowFor('A'), { ctrlKey: true });
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    fireEvent.click(rowFor('B')); // plain
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b' }));
  });

  it('is inert in read-only mode (no onPatch)', () => {
    render(<ObjectFormCanvas objectName="x" draft={flat} />);
    fireEvent.click(rowFor('A'), { ctrlKey: true });
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it('only offers "Move to section" when sections exist', () => {
    // No declared groups → no move target.
    render(<ObjectFormCanvas objectName="x" draft={flat} onPatch={vi.fn()} onSelectionChange={vi.fn()} />);
    fireEvent.click(rowFor('A'), { ctrlKey: true });
    expect(screen.queryByRole('button', { name: /Move to section/ })).not.toBeInTheDocument();
  });

  it('bulk move-to-section assigns the group to selected fields', () => {
    const onPatch = vi.fn();
    render(<ObjectFormCanvas objectName="account" draft={draftWithGroups()} onPatch={onPatch} onSelectionChange={vi.fn()} />);
    fireEvent.click(rowFor('Notes'), { ctrlKey: true }); // an ungrouped field
    fireEvent.click(screen.getByRole('button', { name: /Move to section/ }));
    // Popover lists Ungrouped + the declared sections; pick "Metadata" (key 'meta').
    fireEvent.click(screen.getByRole('button', { name: 'Metadata' }));
    expect(onPatch.mock.calls.at(-1)![0].fields.notes.group).toBe('meta');
  });
});

describe('ObjectFormCanvas — review/diff mode', () => {
  const rowFor = (label: string) => screen.getByText(label).closest('[role="button"]') as HTMLElement;

  it('offers a Review changes toggle only when a baseline differs', () => {
    render(<ObjectFormCanvas objectName="account" draft={REVIEW_DRAFT} baseline={REVIEW_BASELINE} onPatch={vi.fn()} />);
    expect(screen.getByText('Review changes')).toBeInTheDocument();
  });

  it('hides the toggle when there is no baseline', () => {
    render(<ObjectFormCanvas objectName="account" draft={REVIEW_DRAFT} onPatch={vi.fn()} />);
    expect(screen.queryByText('Review changes')).not.toBeInTheDocument();
  });

  it('hides the toggle when the draft equals the baseline', () => {
    render(<ObjectFormCanvas objectName="account" draft={REVIEW_BASELINE} baseline={REVIEW_BASELINE} onPatch={vi.fn()} />);
    expect(screen.queryByText('Review changes')).not.toBeInTheDocument();
  });

  it('shows per-field badges and a removed ghost when reviewing', () => {
    render(<ObjectFormCanvas objectName="account" draft={REVIEW_DRAFT} baseline={REVIEW_BASELINE} onPatch={vi.fn()} />);
    fireEvent.click(screen.getByText('Review changes'));
    // Added badge scoped to the new field's row.
    expect(within(rowFor('Mobile')).getByText('Added')).toBeInTheDocument();
    // Changed badge scoped to the edited field's row.
    expect(within(rowFor('Full Name')).getByText('Changed')).toBeInTheDocument();
    // Removed field shows as a ghost (its label survives only in review mode).
    expect(screen.getByText('Legacy')).toBeInTheDocument();
  });

  it('Exit review removes the diff chrome (incl. the removed ghost)', () => {
    render(<ObjectFormCanvas objectName="account" draft={REVIEW_DRAFT} baseline={REVIEW_BASELINE} onPatch={vi.fn()} />);
    fireEvent.click(screen.getByText('Review changes'));
    expect(screen.getByText('Exit review')).toBeInTheDocument();
    expect(screen.getByText('Legacy')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Exit review'));
    expect(screen.getByText('Review changes')).toBeInTheDocument();
    // The removed-field ghost only exists in review mode.
    expect(screen.queryByText('Legacy')).not.toBeInTheDocument();
  });
});

describe('ObjectFormCanvas — Ask AI entry point', () => {
  it('footer "Ask AI" opens the assistant via the bus', () => {
    const before = assistantBus.getSnapshot().openSeq;
    render(
      <ObjectFormCanvas
        objectName="x"
        draft={{ name: 'x', fields: { a: { type: 'text', label: 'A' } } }}
        onPatch={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Ask AI'));
    expect(assistantBus.getSnapshot().openSeq).toBe(before + 1);
  });

  it('empty-state "Generate fields with AI" opens the assistant', () => {
    const before = assistantBus.getSnapshot().openSeq;
    render(<ObjectFormCanvas objectName="x" draft={{ name: 'x', fields: {} }} onPatch={vi.fn()} />);
    fireEvent.click(screen.getByText('Generate fields with AI'));
    expect(assistantBus.getSnapshot().openSeq).toBe(before + 1);
  });

  it('hides the Ask AI affordance when read-only', () => {
    render(
      <ObjectFormCanvas
        objectName="x"
        draft={{ name: 'x', fields: { a: { type: 'text', label: 'A' } } }}
      />,
    );
    expect(screen.queryByText('Ask AI')).not.toBeInTheDocument();
  });

  it('hides both Ask AI affordances when AI is unavailable (Community Edition)', () => {
    vi.mocked(useAiSurfaceEnabled).mockReturnValue({ enabled: false, isLoading: false });

    // Populated canvas: the toolbar "Ask AI" is gone, but the rest of the
    // toolbar (Add field / Add section) stays.
    const populated = render(
      <ObjectFormCanvas
        objectName="x"
        draft={{ name: 'x', fields: { a: { type: 'text', label: 'A' } } }}
        onPatch={vi.fn()}
      />,
    );
    expect(screen.queryByText('Ask AI')).not.toBeInTheDocument();
    expect(screen.getByText('Add section')).toBeInTheDocument();
    populated.unmount();

    // Empty canvas: "Generate fields with AI" is gone, "Add field" remains so
    // the designer is still usable without AI.
    render(<ObjectFormCanvas objectName="x" draft={{ name: 'x', fields: {} }} onPatch={vi.fn()} />);
    expect(screen.queryByText('Generate fields with AI')).not.toBeInTheDocument();
    expect(screen.getByText('Add field')).toBeInTheDocument();
  });
});

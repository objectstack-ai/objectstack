/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { UserFilters } from '../UserFilters';

const objectDef = {
  name: 'tasks',
  fields: {
    status: {
      type: 'select',
      label: 'Status',
      options: [
        { label: 'To Do', value: 'todo' },
        { label: 'Done', value: 'done' },
      ],
    },
    points: {
      type: 'select',
      label: 'Points',
      options: [
        { label: 'One', value: 1 },
        { label: 'Two', value: 2 },
      ],
    },
    is_active: { type: 'boolean', label: 'Active' },
  },
};

describe('UserFilters — selection persistence (ADR-0047)', () => {
  it('restores dropdown selections from initialSelections and emits conditions on mount', () => {
    const onFilterChange = vi.fn();
    render(
      <UserFilters
        config={{ element: 'dropdown', fields: [{ field: 'status' }] }}
        objectDef={objectDef}
        data={[]}
        onFilterChange={onFilterChange}
        initialSelections={{ status: ['todo'] }}
      />,
    );

    // Badge shows the restored selection count
    expect(screen.getByTestId('filter-badge-status').textContent).toContain('1');
    // The restored selection was emitted as a query condition
    expect(onFilterChange).toHaveBeenCalledWith([['status', 'in', ['todo']]]);
  });

  it('coerces URL-restored string values to typed option values', () => {
    const onFilterChange = vi.fn();
    render(
      <UserFilters
        config={{ element: 'dropdown', fields: [{ field: 'points' }, { field: 'is_active' }] }}
        objectDef={objectDef}
        data={[]}
        onFilterChange={onFilterChange}
        initialSelections={{ points: ['2'], is_active: ['true'] }}
      />,
    );

    const emitted = onFilterChange.mock.calls.at(-1)?.[0];
    expect(emitted).toEqual(
      expect.arrayContaining([
        ['points', 'in', [2]],
        ['is_active', 'in', [true]],
      ]),
    );
  });

  it('fires onSelectionsChange with raw selections when the user changes a dropdown', () => {
    const onSelectionsChange = vi.fn();
    render(
      <UserFilters
        config={{ element: 'dropdown', fields: [{ field: 'status' }] }}
        objectDef={objectDef}
        data={[]}
        onFilterChange={() => {}}
        onSelectionsChange={onSelectionsChange}
      />,
    );

    fireEvent.click(screen.getByTestId('filter-badge-status'));
    fireEvent.click(screen.getByText('To Do'));
    expect(onSelectionsChange).toHaveBeenCalledWith({ status: ['todo'] });

    // Clearing via the badge × empties the selection
    fireEvent.click(screen.getByTestId('filter-clear-status'));
    expect(onSelectionsChange).toHaveBeenLastCalledWith({ status: [] });
  });

  it('restores the active tab from initialSelections._tab and emits its filters', () => {
    const onFilterChange = vi.fn();
    render(
      <UserFilters
        config={{
          element: 'tabs',
          tabs: [
            { name: 'all', label: 'All', isDefault: true },
            { name: 'urgent', label: 'Urgent', filter: [{ field: 'priority', operator: 'equals', value: 'urgent' }] },
          ],
        }}
        objectDef={objectDef}
        data={[]}
        onFilterChange={onFilterChange}
        initialSelections={{ _tab: ['urgent'] }}
      />,
    );

    // Restored tab wins over the isDefault tab and emits its preset filter.
    // The operator stays the spec's canonical `equals` — lowering a rule to an
    // AST node is structural and translates nothing (#3470); `equals` is itself
    // a `VALID_AST_OPERATORS` member, measured 200 on a live backend. Operator
    // coverage proper lives in `UserFilters.tabPresetOperators.test.tsx`.
    expect(onFilterChange).toHaveBeenCalledWith([['priority', 'equals', 'urgent']]);
  });

  it('reports tab switches through onSelectionsChange', () => {
    const onSelectionsChange = vi.fn();
    render(
      <UserFilters
        config={{
          element: 'tabs',
          tabs: [
            { name: 'all', label: 'All', isDefault: true },
            { name: 'urgent', label: 'Urgent', filter: [{ field: 'priority', operator: 'equals', value: 'urgent' }] },
          ],
        }}
        objectDef={objectDef}
        data={[]}
        onFilterChange={() => {}}
        onSelectionsChange={onSelectionsChange}
      />,
    );

    fireEvent.click(screen.getByTestId('filter-tab-urgent'));
    expect(onSelectionsChange).toHaveBeenCalledWith({ _tab: ['urgent'] });
  });
});

describe('UserFilters — dropdown chip label fallback', () => {
  it('falls back to the objectDef field label when the view omits f.label', () => {
    // Compile can strip `label` off userFilters.fields; the chip must not
    // degrade to the raw snake_case key when the object still knows the label.
    render(
      <UserFilters
        config={{ element: 'dropdown', fields: [{ field: 'status' }] }}
        objectDef={objectDef}
        data={[]}
        onFilterChange={() => {}}
      />,
    );

    expect(screen.getByTestId('filter-badge-status').textContent).toContain('Status');
    expect(screen.getByTestId('filter-badge-status').textContent).not.toContain('status');
  });

  it('prefers an author-supplied f.label over the objectDef label', () => {
    render(
      <UserFilters
        config={{ element: 'dropdown', fields: [{ field: 'status', label: 'Stage' }] }}
        objectDef={objectDef}
        data={[]}
        onFilterChange={() => {}}
      />,
    );

    expect(screen.getByTestId('filter-badge-status').textContent).toContain('Stage');
  });

  it('renders the author-supplied label verbatim (issue repro: explicit label must not degrade to key)', () => {
    // Mirrors the reported config: fields carry an explicit Chinese label.
    // The chip must show the label, never the snake_case field key.
    render(
      <UserFilters
        config={{
          element: 'dropdown',
          fields: [
            { field: 'project_type', label: '项目类型' },
            { field: 'manager', label: '管理责任人' },
          ],
        }}
        objectDef={{ name: 'projects', fields: { project_type: { type: 'select' }, manager: { type: 'lookup' } } }}
        data={[]}
        onFilterChange={() => {}}
      />,
    );

    expect(screen.getByTestId('filter-badge-project_type').textContent).toContain('项目类型');
    expect(screen.getByTestId('filter-badge-project_type').textContent).not.toContain('project_type');
    expect(screen.getByTestId('filter-badge-manager').textContent).toContain('管理责任人');
  });

  it('falls back to the raw field key when neither a label nor an objectDef entry exists', () => {
    render(
      <UserFilters
        config={{ element: 'dropdown', fields: [{ field: 'orphan_field', options: [{ label: 'X', value: 'x' }] }] }}
        objectDef={objectDef}
        data={[]}
        onFilterChange={() => {}}
      />,
    );

    expect(screen.getByTestId('filter-badge-orphan_field').textContent).toContain('orphan_field');
  });
});

describe('UserFilters — i18n resolver overrides an explicit author label (regression)', () => {
  // A tenant's translation bundle often carries auto-extracted skeleton entries
  // where the value equals the field key (e.g. `os i18n extract` emits
  // `fields.<obj>.<field> = "<field>"` when the field has no authored label).
  // The dropdown chip runs the author-supplied `f.label` through the
  // convention-based `fieldLabel` resolver as the *fallback*, but the resolver
  // returns any matching bundle entry — including a key-valued skeleton — which
  // then OVERRIDES the explicit label. This is the mechanism behind the reported
  // symptom: chips render raw snake_case keys despite the config declaring
  // Chinese labels.
  const withBundle = (bundle: Record<string, unknown>) =>
    function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <I18nProvider
          config={{
            defaultLanguage: 'en',
            detectBrowserLanguage: false,
            resources: { en: bundle },
          }}
        >
          {children}
        </I18nProvider>
      );
    };

  it('keeps the explicit label when the bundle only holds a key-valued skeleton', () => {
    render(
      <UserFilters
        config={{ element: 'dropdown', fields: [{ field: 'project_type', label: '项目类型' }] }}
        objectDef={{ name: 'projects', fields: { project_type: { type: 'select' } } }}
        data={[]}
        onFilterChange={() => {}}
      />,
      // Bundle mirrors an extracted skeleton: value === field key. Before the fix
      // this clobbered '项目类型' with 'project_type' (the reported symptom).
      { wrapper: withBundle({ crm: { fields: { projects: { project_type: 'project_type' } } } }) },
    );

    const chip = screen.getByTestId('filter-badge-project_type').textContent;
    expect(chip).toContain('项目类型');
    expect(chip).not.toContain('project_type');
  });

  it('a real translation still wins (resolver working as intended)', () => {
    render(
      <UserFilters
        config={{ element: 'dropdown', fields: [{ field: 'project_type', label: 'Project Type' }] }}
        objectDef={{ name: 'projects', fields: { project_type: { type: 'select' } } }}
        data={[]}
        onFilterChange={() => {}}
      />,
      { wrapper: withBundle({ crm: { fields: { projects: { project_type: '项目类型' } } } }) },
    );

    expect(screen.getByTestId('filter-badge-project_type').textContent).toContain('项目类型');
  });
});

describe('UserFilters — every button declares type="button" (objectstack#6952, objectui#3344 family)', () => {
  // An HTML <button> defaults to `type="submit"` INSIDE a <form>, so an untyped
  // filter control submits the enclosing form on every click — objectui#3344's
  // shape, applied to the three UserFilters buttons that predated it.
  //
  // The three were NOT equally at risk, and the difference is measured, not
  // assumed. Reverting the fix leaves the chip (`filter-badge-*`) and the
  // overflow (`user-filters-more`) triggers reading `type="button"` anyway:
  // both are `PopoverTrigger asChild` children, and Radix's PopoverTrigger
  // renders `Primitive.button type="button"`, which its Slot merges onto a
  // child that declares no `type` of its own. Only the preset tab button is a
  // plain button — reverting makes it read `null`, i.e. submit. So the fix is
  // one real (dormant) defect plus two contracts moved from an upstream
  // implementation detail into local source, exactly the reasoning #3344 wrote
  // down on the Combobox trigger.
  //
  // Dormant, not live: the only mount point today (ListView's toolbar) is not
  // inside a form. These assertions keep it that way when composition changes,
  // and they pin the Radix behaviour so an upstream change surfaces here rather
  // than in a user's form.
  const noopSubmit = (e: React.FormEvent) => e.preventDefault();

  const tabsConfig = {
    element: 'tabs' as const,
    tabs: [
      { name: 'all', label: 'All', isDefault: true },
      { name: 'urgent', label: 'Urgent', filter: [{ field: 'priority', operator: 'equals', value: 'urgent' }] },
    ],
  };

  // Radix-supplied today; the assertion pins the rendered contract either way.
  it('dropdown chip trigger declares type="button" and does not submit an enclosing form', () => {
    const onSubmit = vi.fn(noopSubmit);
    render(
      <form onSubmit={onSubmit}>
        <UserFilters
          config={{ element: 'dropdown', fields: [{ field: 'status' }] }}
          objectDef={objectDef}
          data={[]}
          onFilterChange={() => {}}
        />
      </form>,
    );

    const chip = screen.getByTestId('filter-badge-status');
    expect(chip.getAttribute('type')).toBe('button');
    fireEvent.click(chip);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('the chip clear affordance does not submit the enclosing form either', () => {
    // The × lives INSIDE the chip button and only stopPropagation()s, which
    // does not cancel a submit button's activation behaviour — so the chip's
    // own `type` is what keeps a clear click from submitting.
    const onSubmit = vi.fn(noopSubmit);
    render(
      <form onSubmit={onSubmit}>
        <UserFilters
          config={{ element: 'dropdown', fields: [{ field: 'status' }] }}
          objectDef={objectDef}
          data={[]}
          onFilterChange={() => {}}
          initialSelections={{ status: ['todo'] }}
        />
      </form>,
    );

    fireEvent.click(screen.getByTestId('filter-clear-status'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // Radix-supplied today, like the chip.
  it('the "More" overflow trigger declares type="button" and does not submit an enclosing form', () => {
    const onSubmit = vi.fn(noopSubmit);
    render(
      <form onSubmit={onSubmit}>
        <UserFilters
          config={{ element: 'dropdown', fields: [{ field: 'status' }, { field: 'points' }] }}
          objectDef={objectDef}
          data={[]}
          onFilterChange={() => {}}
          maxVisible={1}
        />
      </form>,
    );

    const more = screen.getByTestId('user-filters-more');
    expect(more.getAttribute('type')).toBe('button');
    fireEvent.click(more);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // The one that genuinely rendered as submit before this change.
  it('preset tab buttons declare type="button" and do not submit an enclosing form', () => {
    const onSubmit = vi.fn(noopSubmit);
    render(
      <form onSubmit={onSubmit}>
        <UserFilters config={tabsConfig} objectDef={objectDef} data={[]} onFilterChange={() => {}} />
      </form>,
    );

    const preset = screen.getByTestId('filter-tab-urgent');
    expect(preset.getAttribute('type')).toBe('button');
    expect(screen.getByTestId('filter-tab-all').getAttribute('type')).toBe('button');
    fireEvent.click(preset);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('no rendered UserFilters button is left at the submit default (sweep, both modes)', () => {
    // A sweep rather than three named checks: a future button added to this
    // file is caught here without anyone remembering to extend the list.
    const { container: dropdownContainer } = render(
      <UserFilters
        config={{ element: 'dropdown', fields: [{ field: 'status' }, { field: 'points' }] }}
        objectDef={objectDef}
        data={[]}
        onFilterChange={() => {}}
        maxVisible={1}
      />,
    );
    const dropdownButtons = Array.from(dropdownContainer.querySelectorAll('button'));
    expect(dropdownButtons.length).toBeGreaterThan(0);
    expect(dropdownButtons.map(b => b.getAttribute('type'))).toEqual(dropdownButtons.map(() => 'button'));

    const { container: tabsContainer } = render(
      <UserFilters config={tabsConfig} objectDef={objectDef} data={[]} onFilterChange={() => {}} />,
    );
    const tabButtons = Array.from(tabsContainer.querySelectorAll('button'));
    expect(tabButtons.length).toBeGreaterThan(0);
    expect(tabButtons.map(b => b.getAttribute('type'))).toEqual(tabButtons.map(() => 'button'));
  });
});

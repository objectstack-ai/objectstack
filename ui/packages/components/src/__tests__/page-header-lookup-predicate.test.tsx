/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `page:header` — relation fields in a header action's `visible` / `disabled`
 * (objectui#3501).
 *
 * The record-header surface is where the reported symptom was seen. The detail
 * fetch expands every relation it can, so `ctx.data.owner` arrives as the whole
 * related record rather than the id it stands for. Evaluated as delivered, that
 * makes the two natural spellings fail in opposite directions on the LEGACY JS
 * evaluator this surface uses:
 *
 *   `os.user.id == record.owner`     → `'U1' == {…}` → a clean, silent FALSE,
 *                                       even on the caller's own record
 *   `os.user.id == record.owner.id`  → throws the moment `owner` is empty
 *
 * Binding the record the way the server does — relation ⇒ foreign key — is what
 * makes the first spelling (the one that also works in a bare list and in a
 * server-side rule) the right one everywhere.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider, PredicateScopeProvider } from '@object-ui/react';

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- registry component is stable
  return <Component schema={schema} />;
}

const OBJECT_SCHEMA = {
  name: 'showcase_task',
  label: 'Task',
  fields: {
    title: { type: 'text' },
    owner: { type: 'user' },
    project: { type: 'master_detail', reference: 'showcase_project' },
  },
};

const schema = (visible: string) => ({
  type: 'page:header',
  title: 'Task',
  actions: [{ name: 'reassign', locations: ['record_header'], label: 'Reassign', type: 'api', visible }],
});

function renderHeader(record: any, visible: string) {
  return render(
    <PredicateScopeProvider scope={{ user: { id: 'U1' }, os: { user: { id: 'U1' } } }}>
      <ActionProvider>
        <RecordContextProvider
          objectName="showcase_task"
          recordId={record?.id ?? null}
          data={record}
          objectSchema={OBJECT_SCHEMA}
        >
          <PageHeader schema={schema(visible)} />
        </RecordContextProvider>
      </ActionProvider>
    </PredicateScopeProvider>,
  );
}

const shown = () => !!screen.queryByRole('button', { name: /Reassign/i });

const EXPANDED = {
  id: 'r1',
  title: 'SEO migration plan',
  owner: { id: 'U1', name: 'Ada Lovelace' },
  project: { id: 'P1', name: 'Website Relaunch' },
};

describe('page:header — relation fields in `visible` (#3501)', () => {
  it('shows the action on the caller’s own record, with `owner` expanded', () => {
    renderHeader(EXPANDED, 'os.user.id == record.owner');
    expect(shown()).toBe(true);
  });

  it('reaches the same verdict when the record arrived UNexpanded', () => {
    renderHeader({ ...EXPANDED, owner: 'U1' }, 'os.user.id == record.owner');
    expect(shown()).toBe(true);
  });

  it('still hides it on someone else’s record', () => {
    renderHeader({ ...EXPANDED, owner: { id: 'U2', name: 'Grace' } }, 'os.user.id == record.owner');
    expect(shown()).toBe(false);
  });

  it('hides it cleanly when the relation is empty — no throw to fall back on', () => {
    renderHeader({ ...EXPANDED, owner: null }, 'os.user.id == record.owner');
    expect(shown()).toBe(false);
  });

  it('compares a master_detail relation against a literal id', () => {
    renderHeader(EXPANDED, 'record.project == "P1"');
    expect(shown()).toBe(true);
  });

  it('leaves the record’s own display data expanded — the title still reads the NAME', () => {
    // The normalization is scoped to predicate evaluation; `interpolate` keeps
    // reading `ctx.data`, so a `{project.name}` title is unaffected.
    render(
      <PredicateScopeProvider scope={{ user: { id: 'U1' }, os: { user: { id: 'U1' } } }}>
        <ActionProvider>
          <RecordContextProvider
            objectName="showcase_task"
            recordId="r1"
            data={EXPANDED}
            objectSchema={OBJECT_SCHEMA}
          >
            <PageHeader schema={{ type: 'page:header', title: '{project.name}' }} />
          </RecordContextProvider>
        </ActionProvider>
      </PredicateScopeProvider>,
    );

    expect(screen.getByText('Website Relaunch')).toBeTruthy();
  });
});

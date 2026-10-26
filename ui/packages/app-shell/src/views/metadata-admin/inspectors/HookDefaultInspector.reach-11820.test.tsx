// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11820 — the hook target picker says where a hook's reach widens.
 *
 * A hook on an object runs on that object's events wherever they happen. The
 * picker listed every object — this package's, other packages', the
 * platform's own `sys_*` tables — in one flat list, and "All objects (*)" with
 * it, with no word about reach. Now, when the host says which objects belong
 * to the hook's package (`HookTargetScopeContext`, which Studio's hooks panel
 * provides), this package's objects come first under "This package" and every
 * other object sits under "Other objects" with a one-line reach warning; "All
 * objects" carries the same kind of warning.
 *
 * Membership is the package's own list, never a name prefix: here `sys_user`
 * is outside because the package does not list it, and an object whose name
 * merely looks like the package's is outside too.
 *
 * Controls: a host that knows no package (the metadata admin's editor) gets the
 * flat list with no warning; ticking an outside object, and choosing "All
 * objects" deliberately, still write what they wrote before.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

const state = vi.hoisted(() => ({
  metadataClient: {
    get: vi.fn(async () => undefined),
    withPreviewDrafts() { return this; },
    list: vi.fn(
      async () =>
        [
          { name: 'crm_account', label: 'Account' },
          { name: 'crm_contact', label: 'Contact' },
          { name: 'crm_lookalike', label: 'Lookalike' },
          { name: 'hr_employee', label: 'Employee' },
          { name: 'sys_user', label: 'User', isSystem: true },
        ] as unknown[],
    ),
  },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { HookDefaultInspector, HookTargetScopeContext, type HookTargetScope } from './HookDefaultInspector';

afterEach(cleanup);

const SCOPE: HookTargetScope = { packageObjects: new Set(['crm_account', 'crm_contact']) };
const REACH = /These belong to other packages or to the platform/;

async function mount(opts: { object: unknown; scope: HookTargetScope | null }) {
  const onPatch = vi.fn();
  render(
    <HookTargetScopeContext.Provider value={opts.scope}>
      <HookDefaultInspector
        type="hook"
        name="audit_hook"
        draft={{ name: 'audit_hook', object: opts.object, events: ['beforeInsert'] }}
        onPatch={onPatch}
        readOnly={false}
        locale="en-US"
      />
    </HookTargetScopeContext.Provider>,
  );
  // The catalog answered.
  if (opts.object !== '*') await screen.findByRole('checkbox', { name: 'Account (crm_account)' });
  return onPatch;
}

describe('hook target picker — reach (objectui#11820)', () => {
  it('lists this package’s objects first, and every other object under its own heading with the warning', async () => {
    await mount({ object: 'crm_account', scope: SCOPE });

    const own = screen.getByRole('group', { name: 'This package' });
    expect(within(own).getByRole('checkbox', { name: 'Account (crm_account)' })).toBeChecked();
    expect(within(own).getByRole('checkbox', { name: 'Contact (crm_contact)' })).toBeInTheDocument();
    expect(within(own).queryByRole('checkbox', { name: 'User (sys_user)' })).toBeNull();

    const outside = screen.getByRole('group', { name: 'Other objects' });
    expect(within(outside).getByTestId('hook-object-outside-reach')).toHaveTextContent(REACH);
    for (const label of ['User (sys_user)', 'Employee (hr_employee)', 'Lookalike (crm_lookalike)']) {
      expect(within(outside).getByRole('checkbox', { name: label })).toBeInTheDocument();
    }
    expect(within(outside).queryByRole('checkbox', { name: 'Account (crm_account)' })).toBeNull();
    // The warning is said once, at the group — not on the package's objects.
    expect(screen.getAllByTestId('hook-object-outside-reach')).toHaveLength(1);
  });

  it('control — ticking a platform object still writes it beside the package object', async () => {
    const onPatch = await mount({ object: 'crm_account', scope: SCOPE });
    const outside = screen.getByRole('group', { name: 'Other objects' });
    fireEvent.click(within(outside).getByRole('checkbox', { name: 'User (sys_user)' }));
    expect(onPatch).toHaveBeenLastCalledWith({ object: ['crm_account', 'sys_user'] });
  });

  it('"All objects" carries a reach warning, and choosing it deliberately still writes `*`', async () => {
    const onPatch = await mount({ object: 'crm_account', scope: SCOPE });
    expect(screen.queryByTestId('hook-all-objects-reach')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'All objects (*)' }));
    expect(onPatch).toHaveBeenLastCalledWith({ object: '*' });
    cleanup();

    await mount({ object: '*', scope: SCOPE });
    expect(screen.getByTestId('hook-all-objects-reach')).toHaveTextContent(
      'Runs on the events of every object — other packages’ objects and the platform’s own (sys_…) tables included.',
    );
  });

  it('control — with no package known, the list is one flat list with no headings and no warning', async () => {
    await mount({ object: 'crm_account', scope: null });
    expect(screen.queryByRole('group', { name: 'This package' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Other objects' })).toBeNull();
    expect(screen.queryByTestId('hook-object-outside-reach')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'User (sys_user)' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Account (crm_account)' })).toBeChecked();
  });
});

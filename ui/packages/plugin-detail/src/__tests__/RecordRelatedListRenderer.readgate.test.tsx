/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Automatic object-level read gate on `record:related_list` (objectui#2359).
 *
 * A related list surfaces the CHILD object's records, so it requires `read`
 * on that object. When the permission system is loaded and denies read, the
 * whole section must vanish — previously the section rendered an empty grid
 * (the data fetch 403'd server-side) plus a "New" button that 403'd on save.
 * With no PermissionProvider mounted (Studio designer, standalone embeds)
 * the gate stays open: `usePermissions()` reports `isLoaded: false` there.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import * as React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { PermissionProvider } from '@object-ui/permissions';
import type { ObjectPermissionConfig, RoleDefinition } from '@object-ui/types';
import { RecordRelatedListRenderer } from '../renderers/record-related-list';

// Capture whether/what the renderer passes down to RelatedList.
const h = vi.hoisted(() => ({ captured: null as any }));
vi.mock('../RelatedList', () => ({
  RelatedList: (props: any) => {
    h.captured = props;
    return <div data-testid="related-list" />;
  },
}));

const ds = { find: vi.fn(async () => []) };

const roles: RoleDefinition[] = [
  { name: 'restricted', label: 'Restricted' },
];

function contactPerms(actions: Array<'read'>): ObjectPermissionConfig[] {
  return [{ object: 'contact', roles: { restricted: { actions } } }];
}

function renderGated(permissions: ObjectPermissionConfig[]) {
  return render(
    <PermissionProvider roles={roles} permissions={permissions} userRoles={['restricted']}>
      <RecordContextProvider objectName="account" recordId="ACC-1" dataSource={ds as any}>
        <RecordRelatedListRenderer
          schema={{ objectName: 'contact', relationshipField: 'account_id' }}
        />
      </RecordContextProvider>
    </PermissionProvider>,
  );
}

beforeEach(() => {
  h.captured = null;
});

describe('RecordRelatedListRenderer — automatic object-level read gate (#2359)', () => {
  it('renders nothing at all when the user cannot read the child object', () => {
    const { container } = renderGated(contactPerms([]));
    expect(h.captured).toBeNull();
    // Entirely suppressed — no header, no empty grid, no permission notice.
    expect(container.innerHTML).toBe('');
  });

  it('renders the list when the user can read the child object', () => {
    renderGated(contactPerms(['read']));
    expect(h.captured).not.toBeNull();
    expect(h.captured.objectName).toBe('contact');
  });

  it('renders when the permission config says nothing about the child object', () => {
    // No config for `contact` → evaluator default-allows.
    renderGated([]);
    expect(h.captured).not.toBeNull();
  });

  it('renders with no PermissionProvider mounted (isLoaded=false → gate stays open)', () => {
    render(
      <RecordContextProvider objectName="account" recordId="ACC-1" dataSource={ds as any}>
        <RecordRelatedListRenderer
          schema={{ objectName: 'contact', relationshipField: 'account_id' }}
        />
      </RecordContextProvider>,
    );
    expect(h.captured).not.toBeNull();
  });
});

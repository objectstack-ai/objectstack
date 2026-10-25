/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { InlineEditProvider, useInlineEdit } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { SystemFieldName } from '@objectstack/spec/system';
import type { DetailViewSection } from '@object-ui/types';
import { DetailSection } from '../DetailSection';
import { HeaderHighlight } from '../HeaderHighlight';

/**
 * objectui#12103 — the record page's in-place edit asks the CALLER's field
 * write grant.
 *
 * Measured on a live backend before this change: for a caller whose permission
 * set reads `{ readable: true, editable: false }` for a field, and whose object
 * grant carries `allowEdit: true` and `allowTransfer: false`,
 * `/api/v1/auth/me/permissions` answers exactly that, and the server refuses a
 * PATCH of the field ("Field write denied") and of the owner ("requires the
 * transfer grant") with 403, while a PATCH of an ordinary field succeeds. The
 * details body and the highlights strip still offered an editor for both.
 *
 * Both surfaces now ask the field question of the `recordEdit` row of the
 * affordance-to-grant map — the same `write` question an edit form asks — so
 * the envelope below is the measured one, not an invented shape. Assertions
 * are behavioural (does double-click enter edit; does edit mode draw an input)
 * and do not depend on the localized hint text.
 */

const OBJECT = 'crm_account';
const OWNER = SystemFieldName.OWNER_ID;

/** The measured envelope: may edit the object, may not edit annual revenue, may not transfer. */
function envelope(objectBits: Record<string, boolean> = {}): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u-rep',
    tenantId: null,
    roles: [],
    permissionSets: ['rep'],
    objects: {
      [OBJECT]: {
        allowRead: true,
        allowCreate: false,
        allowEdit: true,
        allowDelete: false,
        allowTransfer: false,
        ...objectBits,
      },
    },
    fields: { [`${OBJECT}.annual_revenue`]: { readable: true, editable: false } },
  };
}

const objectSchema = {
  fields: {
    name: { type: 'text' },
    annual_revenue: { type: 'text' },
    // The owner as the platform injects it: an editable lookup to sys_user.
    [OWNER]: { type: 'lookup', reference: 'sys_user' },
  },
};

const data = { name: 'Acme', annual_revenue: '5000', [OWNER]: 'Alice' };

const section = {
  fields: [
    { name: 'name', label: 'Name' },
    { name: 'annual_revenue', label: 'Annual revenue' },
    { name: OWNER, label: 'Owner' },
  ],
} as DetailViewSection;

/** Render under the measured grant, or under no provider at all. */
function withPerms(perms: MePermissionsResponse | null, node: React.ReactNode) {
  return render(perms ? <MePermissionsProvider initialPermissions={perms}>{node}</MePermissionsProvider> : <>{node}</>);
}

beforeAll(() => {
  // useIsMobile() keys off window.innerWidth; pin a desktop width so the
  // read-mode desktop row (which carries the affordance) renders.
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

afterEach(cleanup);

describe('the details body asks the field write grant (objectui#12103)', () => {
  function enteredOnDoubleClick(perms: MePermissionsResponse | null, text: string): string[] {
    const onEnter = vi.fn();
    withPerms(
      perms,
      <DetailSection section={section} data={data} objectSchema={objectSchema} objectName={OBJECT} onEnterInlineEdit={onEnter} />,
    );
    fireEvent.doubleClick(screen.getByText(text));
    return onEnter.mock.calls.map((c) => c[0]);
  }

  it('a field marked editable: false offers no in-place edit', () => {
    expect(enteredOnDoubleClick(envelope(), '5000')).toEqual([]);
  });

  it('the owner field without the transfer grant offers no in-place edit', () => {
    expect(enteredOnDoubleClick(envelope(), 'Alice')).toEqual([]);
  });

  it('the owner field WITH the transfer grant does', () => {
    expect(enteredOnDoubleClick(envelope({ allowTransfer: true }), 'Alice')).toEqual([OWNER]);
  });

  it('CONTROL: an editable field is unchanged', () => {
    expect(enteredOnDoubleClick(envelope(), 'Acme')).toEqual(['name']);
  });

  it('CONTROL: with no permission provider every field edits, as before', () => {
    expect(enteredOnDoubleClick(null, '5000')).toEqual(['annual_revenue']);
    cleanup();
    expect(enteredOnDoubleClick(null, 'Alice')).toEqual([OWNER]);
  });

  it('in edit mode the refused field stays a read display while the editable one is an input', () => {
    withPerms(
      envelope(),
      <DetailSection section={section} data={data} objectSchema={objectSchema} objectName={OBJECT} isEditing />,
    );
    expect(screen.getByDisplayValue('Acme')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('5000')).toBeNull();
    expect(screen.getByText('5000')).toBeInTheDocument();
  });
});

describe('the highlights strip asks the same question (objectui#12103)', () => {
  /** Surfaces the shared session, so a test can read whether double-click entered it. */
  function SessionProbe() {
    const inline = useInlineEdit();
    return <div data-testid="session">{inline?.editing ? `editing:${inline.autoFocusField ?? ''}` : 'idle'}</div>;
  }

  function strip(perms: MePermissionsResponse | null) {
    return withPerms(
      perms,
      <InlineEditProvider canEdit>
        <HeaderHighlight fields={section.fields as any} data={data} objectSchema={objectSchema} objectName={OBJECT} />
        <SessionProbe />
      </InlineEditProvider>,
    );
  }

  it('double-clicking a refused highlight does not enter the edit session', () => {
    strip(envelope());
    fireEvent.doubleClick(screen.getByText('5000'));
    expect(screen.getByTestId('session').textContent).toBe('idle');
  });

  it('nor does the owner without the transfer grant; with it, it does', () => {
    strip(envelope());
    fireEvent.doubleClick(screen.getByText('Alice'));
    expect(screen.getByTestId('session').textContent).toBe('idle');
    cleanup();
    strip(envelope({ allowTransfer: true }));
    fireEvent.doubleClick(screen.getByText('Alice'));
    expect(screen.getByTestId('session').textContent).toBe(`editing:${OWNER}`);
  });

  it('CONTROL: an editable highlight enters the session and becomes an input', () => {
    strip(envelope());
    fireEvent.doubleClick(screen.getByText('Acme'));
    expect(screen.getByTestId('session').textContent).toBe('editing:name');
    expect(screen.getByDisplayValue('Acme')).toBeInTheDocument();
  });

  it('once the session is open, the refused highlight stays a read display', () => {
    strip(envelope());
    fireEvent.doubleClick(screen.getByText('Acme'));
    expect(screen.queryByDisplayValue('5000')).toBeNull();
    expect(screen.getByText('5000')).toBeInTheDocument();
  });
});

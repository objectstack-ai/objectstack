/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record picker's display column reads its title through
 * `@object-ui/core`'s `withoutDeniedFields`, the one field-read rule every
 * display surface calls (objectui#10594). The picker's module-private copy is
 * gone.
 *
 * Pinned against the real dialog and the production policy provider
 * (`MePermissionsProvider`, an authenticated session: an object the payload
 * does not name is denied, #2926 ④):
 *
 *  - a named object (control): a field the loaded policy denies is not in the
 *    display column's title, and the declared `idField` is kept in the row the
 *    title reads even when the policy denies it (the `[idField]` this site
 *    hands the export), so the title still shows it and a row click still
 *    commits it;
 *  - a picker OPENED with an empty object name issues no read and draws no
 *    row, although the backend here answers for any object name. This leg
 *    observes the query kernel's gate (`useRecordQuery` reads nothing without
 *    an object name), not the field-read rule; it records why a host that
 *    opens the picker with no name sees an empty table under either rule;
 *  - the ruled pass-through on an empty object name (ruling 5861445694 on
 *    objectui#10594): the deleted copy judged every field but `id`, `_id` and
 *    `idField` against `''`, which this provider denies, and the export passes
 *    the row through. The picker holds rows under an empty name only in the
 *    commit after a host empties the name of an OPEN picker, before the kernel
 *    clears the previous object's rows. With `idField` equal to the display
 *    field, the column gate keeps that column by identity on `''`, so its title
 *    is drawn there. The leg asserts the NEGATIVE: no title drawn under the
 *    empty name is one stripped against `''`. It is red on the deleted copy and
 *    on an export or dialog that fails closed on `''`, and it stays green if
 *    the kernel ever clears the rows in the same commit (the snapshot then
 *    holds no cell).
 *
 * `RecordPickerDialog.displayFls-10373.test.tsx` pins the column gates (which
 * columns are headed and drawn) against the role-based provider.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererContext } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { RecordPickerDialog } from './RecordPickerDialog';
import { getCellRenderer } from '../index';

const ACCOUNT_FIELDS: Record<string, any> = {
  name: { type: 'text', label: 'Name' },
  code: { type: 'text', label: 'Code' },
  secret: { type: 'text', label: 'Secret' },
};

/**
 * A backend that does NOT strip denied keys (ObjectStack's `FieldMasker`
 * would), and that answers for ANY object name, so a read issued for an empty
 * name would put rows on screen.
 */
function makeBackend(prefix: string) {
  const rows = [0, 1, 2].map((i) => ({
    id: `${prefix}_acct_${i}`,
    code: `C-${prefix}-${i}`,
    name: `Account ${i}`,
    secret: `S-${prefix}-${i}`,
  }));
  const find = vi.fn(async () => ({ data: rows.map((r) => ({ ...r })), total: rows.length }));
  return { find, findOne: vi.fn(async () => null) } as any;
}

/**
 * An authenticated `/me/permissions` payload: `account` is readable, and each
 * named `account` field is not.
 */
function policyDenying(...fields: string[]): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: null,
    roles: ['viewer'],
    permissionSets: [],
    objects: { account: { allowRead: true } },
    fields: Object.fromEntries(fields.map((f) => [`account.${f}`, { readable: false }])),
  };
}

function Picker({
  ds,
  objectName,
  onSelect = () => {},
}: {
  ds: ReturnType<typeof makeBackend>;
  objectName: string;
  onSelect?: (v: unknown) => void;
}) {
  return (
    <SchemaRendererContext.Provider value={{ dataSource: ds } as any}>
      <RecordPickerDialog
        open
        onOpenChange={() => {}}
        dataSource={ds}
        objectName={objectName}
        idField="code"
        onSelect={onSelect}
        cellRenderer={getCellRenderer}
        fieldsMeta={ACCOUNT_FIELDS}
        objectSchema={{ name: 'account', fields: ACCOUNT_FIELDS, titleFormat: '{name} - {code} - {secret}' }}
      />
    </SchemaRendererContext.Provider>
  );
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function cells(field: string): string[] {
  return Array.from(document.querySelectorAll(`[data-lookup-cell="${field}"]`)).map(
    (el) => el.textContent ?? '',
  );
}

type Snapshot = { objectName: string; cells: string[] };

/** One module-level payload, so a host rerender hands the provider the same object. */
const SECRET_DENIED = policyDenying('secret');

/**
 * A host that keeps the picker OPEN while its object name changes, and records
 * the drawn display cells after every commit of its own (a layout effect runs
 * after the commit's DOM writes). `idField` is the display field, so the
 * picker's column gate keeps the display column by identity even on `''`.
 */
function RenamingHost({ ds, objectName, log }: { ds: ReturnType<typeof makeBackend>; objectName: string; log: Snapshot[] }) {
  React.useLayoutEffect(() => {
    log.push({ objectName, cells: cells('name') });
  });
  return (
    <SchemaRendererContext.Provider value={{ dataSource: ds } as any}>
      <RecordPickerDialog
        open
        onOpenChange={() => {}}
        dataSource={ds}
        objectName={objectName}
        idField="name"
        onSelect={() => {}}
        cellRenderer={getCellRenderer}
        fieldsMeta={ACCOUNT_FIELDS}
        objectSchema={{ name: 'account', fields: ACCOUNT_FIELDS, titleFormat: '{name} - {secret}' }}
      />
    </SchemaRendererContext.Provider>
  );
}

afterEach(() => {
  cleanup();
});

describe('RecordPickerDialog — the display title reads the shared field-read rule (objectui#10594)', () => {
  it('a named object: a denied field is not in the title; the declared id field is kept even when denied, and a row click commits it', async () => {
    const ds = makeBackend('named');
    const onSelect = vi.fn();
    render(
      <MePermissionsProvider initialPermissions={policyDenying('secret', 'code')}>
        <Picker ds={ds} objectName="account" onSelect={onSelect} />
      </MePermissionsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('record-row-C-named-1')).toBeInTheDocument());
    await settle();

    expect(cells('name')).toEqual([
      'Account 0 - C-named-0',
      'Account 1 - C-named-1',
      'Account 2 - C-named-2',
    ]);
    expect(document.body.textContent).not.toContain('S-named-');
    await act(async () => {
      fireEvent.click(screen.getByTestId('record-row-C-named-1'));
    });
    expect(onSelect).toHaveBeenCalledWith('C-named-1');
  });

  it('a picker opened with an empty object name under a loaded policy: no read is issued and no row is drawn', async () => {
    const ds = makeBackend('empty');
    render(
      <MePermissionsProvider initialPermissions={policyDenying('secret')}>
        <Picker ds={ds} objectName="" />
      </MePermissionsProvider>,
    );
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await settle();

    expect(ds.find).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[data-testid^="record-row-"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-lookup-cell]')).toHaveLength(0);
    expect(document.body.textContent).not.toContain('Account 0');
  });

  it('the ruled pass-through: after a host empties the name of an open picker, no drawn title is one stripped against the empty name', async () => {
    const ds = makeBackend('renamed');
    const log: Snapshot[] = [];
    const { rerender } = render(
      <MePermissionsProvider initialPermissions={SECRET_DENIED}>
        <RenamingHost ds={ds} objectName="account" log={log} />
      </MePermissionsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('record-row-Account 1')).toBeInTheDocument());
    await settle();

    // The snapshot is live: a host commit on the named object records the drawn
    // titles, with the denied `secret` stripped and the id field kept.
    await act(async () => {
      rerender(
        <MePermissionsProvider initialPermissions={SECRET_DENIED}>
          <RenamingHost ds={ds} objectName="account" log={log} />
        </MePermissionsProvider>,
      );
    });
    expect(log[log.length - 1]).toEqual({
      objectName: 'account',
      cells: ['Account 0', 'Account 1', 'Account 2'],
    });

    await act(async () => {
      rerender(
        <MePermissionsProvider initialPermissions={SECRET_DENIED}>
          <RenamingHost ds={ds} objectName="" log={log} />
        </MePermissionsProvider>,
      );
    });
    await settle();

    const underEmptyName = log.filter((s) => s.objectName === '');
    expect(underEmptyName.length).toBeGreaterThan(0);
    // A title stripped against `''` is the bare name: this provider denies every
    // field of an object it does not name, and only the id field is exempt.
    for (const snapshot of underEmptyName) {
      for (const cell of snapshot.cells) expect(cell).not.toMatch(/^Account \d$/);
    }
    expect(ds.find).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('[data-testid^="record-row-"]')).toHaveLength(0);
  });
});

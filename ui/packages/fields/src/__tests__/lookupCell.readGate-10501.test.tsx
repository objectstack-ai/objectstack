/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The lookup CELL names the referenced record from the fields the viewer may
 * read — objectui#10501.
 *
 * `LookupCellRenderer` resolves the referenced record's display name through
 * the referenced object's schema (`displayField` → `nameField` → `titleFormat`
 * → derivation). It did that on the row as served, so on a backend that does
 * not strip denied keys (ObjectStack's `FieldMasker` does) a `titleFormat` or
 * `nameField` naming a field the loaded policy denies printed that field's
 * value in every list and grid cell. The lookup EDITOR's option label already
 * applied the rule (objectui#10411), and so does the record title
 * (objectui#10434): a display value is built from the row with the denied
 * fields removed, `id` kept.
 *
 * What is pinned, against the real `PermissionProvider` (not a stub), on the
 * REFERENCED object's policy:
 *
 *  - every shape the cell names a record from — an expanded record, a bare id
 *    fetched on demand, a multi-value cell (chips and the overflow title) and
 *    a JSON-encoded reference — prints no denied field, and names the record
 *    exactly as a stripping backend's row names it;
 *  - lit controls: a field the policy does NOT deny still prints, and with no
 *    policy loaded (no provider: `isLoaded` is false) the row is named as
 *    served — so the pins above read a GATE, not a name that went missing;
 *  - a policy that arrives after mount relabels the SAME mounted cell, on the
 *    expanded path and on the fetched path.
 *
 * Every test names its own referenced object: the cell's record and schema
 * caches are module-level and outlive a test.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererProvider } from '@object-ui/react';
import { PermissionProvider } from '@object-ui/permissions';
import type { DataSource, FieldMetadata, ObjectPermissionConfig } from '@object-ui/types';
import { LookupCellRenderer } from '../index';

const ADA = { id: 'p1', name: 'Ada Lovelace', email: 'ada@example.com', phone: '555-0100' };
const PEOPLE = [
  ADA,
  { id: 'p2', name: 'Grace Hopper', email: 'grace@example.com', phone: '555-0101' },
  { id: 'p3', name: 'Alan Turing', email: 'alan@example.com', phone: '555-0102' },
  { id: 'p4', name: 'Edsger Dijkstra', email: 'edsger@example.com', phone: '555-0103' },
];
const EMAILS = PEOPLE.map((p) => p.email);

/** `row` as a stripping backend (ObjectStack's `FieldMasker`) serves it. */
function stripped<T extends Record<string, unknown>>(row: T, ...denied: string[]): T {
  const copy: Record<string, unknown> = { ...row };
  for (const field of denied) delete copy[field];
  return copy as T;
}

/**
 * A backend that does NOT strip denied keys — the case this gate defends.
 * `findOne` serves `records` by id; `getObjectSchema` serves `schema`.
 */
function makeDataSource(objectName: string, schema: Record<string, unknown>, records: Record<string, unknown>[] = []) {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async (object: string, id: string) =>
      object === objectName ? records.find((r) => r.id === id) ?? null : null,
    ),
    getObjectSchema: vi.fn(async (object: string) => (object === objectName ? schema : undefined)),
  };
}

/** The double implements only the three reads the cell makes. */
type DataSourceDouble = ReturnType<typeof makeDataSource>;

/** The real role-based policy, denying the named fields of `objectName` to `viewer`. */
function policyDenying(objectName: string, ...fields: string[]): ObjectPermissionConfig[] {
  return [
    {
      object: objectName,
      roles: {
        viewer: { actions: ['read'], fieldPermissions: fields.map((field) => ({ field, read: false })) },
      },
    } as ObjectPermissionConfig,
  ];
}

function Cell({
  ds,
  objectName,
  value,
  policy,
}: {
  ds: DataSourceDouble;
  objectName: string;
  value: unknown;
  /** Omitted: no provider mounted, so no policy is loaded. */
  policy?: ObjectPermissionConfig[];
}) {
  const cell = (
    <div data-testid="cell">
      <SchemaRendererProvider dataSource={ds as unknown as DataSource}>
        <LookupCellRenderer value={value} field={{ type: 'lookup', reference: objectName } as FieldMetadata} />
      </SchemaRendererProvider>
    </div>
  );
  if (!policy) return cell;
  return (
    <PermissionProvider roles={[]} userRoles={['viewer']} permissions={policy}>
      {cell}
    </PermissionProvider>
  );
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Render one cell, let its schema (and any on-demand record) land, return what it drew. */
async function drawn(props: React.ComponentProps<typeof Cell>): Promise<{ text: string; html: string }> {
  render(<Cell {...props} />);
  await waitFor(() => expect(props.ds.getObjectSchema).toHaveBeenCalledWith(props.objectName));
  await settle();
  const el = screen.getByTestId('cell');
  const out = { text: el.textContent ?? '', html: el.innerHTML };
  cleanup();
  return out;
}

afterEach(() => {
  cleanup();
});

describe('LookupCellRenderer — the referenced record is named from the fields the viewer may read (objectui#10501)', () => {
  it('an expanded record: a denied `titleFormat` field is not printed; the cell reads as a stripping backend makes it read', async () => {
    const gated = await drawn({
      ds: makeDataSource('rg_person_tf', { titleFormat: '{email}' }),
      objectName: 'rg_person_tf',
      value: ADA,
      policy: policyDenying('rg_person_tf', 'email'),
    });
    const served = await drawn({
      ds: makeDataSource('rg_person_tf_strip', { titleFormat: '{email}' }),
      objectName: 'rg_person_tf_strip',
      value: stripped(ADA, 'email'),
    });

    expect(gated.html).not.toContain('ada@example.com');
    expect(gated.text).toBe('Ada Lovelace');
    expect(gated.text).toBe(served.text);
  });

  it('an expanded record: a denied `nameField` is not printed', async () => {
    const gated = await drawn({
      ds: makeDataSource('rg_person_nf', { nameField: 'email' }),
      objectName: 'rg_person_nf',
      value: ADA,
      policy: policyDenying('rg_person_nf', 'email'),
    });

    expect(gated.html).not.toContain('ada@example.com');
    expect(gated.text).toBe('Ada Lovelace');
  });

  it('a bare id fetched on demand: the fetched record is named from its readable fields', async () => {
    const ds = makeDataSource('rg_person_fetch', { titleFormat: '{email}' }, PEOPLE);
    render(<Cell ds={ds} objectName="rg_person_fetch" value="p1" policy={policyDenying('rg_person_fetch', 'email')} />);

    await waitFor(() => expect(screen.getByTestId('cell')).toHaveTextContent('Ada Lovelace'));
    await settle();
    expect(ds.findOne).toHaveBeenCalledWith('rg_person_fetch', 'p1');
    expect(screen.getByTestId('cell').innerHTML).not.toContain('ada@example.com');
  });

  it('a multi-value cell: every chip, and the overflow chip title, is named from the readable fields', async () => {
    const gated = await drawn({
      ds: makeDataSource('rg_person_many', { titleFormat: '{email}' }),
      objectName: 'rg_person_many',
      value: PEOPLE,
      policy: policyDenying('rg_person_many', 'email'),
    });

    for (const email of EMAILS) expect(gated.html).not.toContain(email);
    expect(gated.text).toBe('Ada LovelaceGrace HopperAlan Turing+1');
    expect(gated.html).toContain('title="Edsger Dijkstra"');
  });

  it('a JSON-encoded reference is named from the readable fields', async () => {
    const gated = await drawn({
      ds: makeDataSource('rg_person_json', { titleFormat: '{email}' }),
      objectName: 'rg_person_json',
      value: JSON.stringify(ADA),
      policy: policyDenying('rg_person_json', 'email'),
    });

    expect(gated.html).not.toContain('ada@example.com');
    expect(gated.text).toBe('Ada Lovelace');
  });

  it('control: a field the policy does NOT deny still prints, expanded and fetched', async () => {
    const expanded = await drawn({
      ds: makeDataSource('rg_person_lit', { titleFormat: '{email}' }),
      objectName: 'rg_person_lit',
      value: ADA,
      policy: policyDenying('rg_person_lit', 'phone'),
    });
    expect(expanded.text).toBe('ada@example.com');

    const ds = makeDataSource('rg_person_lit_fetch', { titleFormat: '{email}' }, PEOPLE);
    render(<Cell ds={ds} objectName="rg_person_lit_fetch" value="p1" policy={policyDenying('rg_person_lit_fetch', 'phone')} />);
    await waitFor(() => expect(screen.getByTestId('cell')).toHaveTextContent('ada@example.com'));
  });

  it('control: with no policy loaded (no provider), the row is named as served', async () => {
    const served = await drawn({
      ds: makeDataSource('rg_person_none', { titleFormat: '{email}' }),
      objectName: 'rg_person_none',
      value: ADA,
    });
    expect(served.text).toBe('ada@example.com');
  });

  describe('a policy that arrives after mount relabels the same mounted cell', () => {
    function Host({ ds, objectName, value }: { ds: DataSourceDouble; objectName: string; value: unknown }) {
      const [policy, setPolicy] = React.useState<ObjectPermissionConfig[]>([]);
      return (
        <>
          <button type="button" data-testid="deny-email" onClick={() => setPolicy(policyDenying(objectName, 'email'))} />
          <Cell ds={ds} objectName={objectName} value={value} policy={policy} />
        </>
      );
    }

    async function relabels(ds: DataSourceDouble, objectName: string, value: unknown): Promise<void> {
      render(<Host ds={ds} objectName={objectName} value={value} />);
      await waitFor(() => expect(screen.getByTestId('cell')).toHaveTextContent('ada@example.com'));
      await settle();
      const label = within(screen.getByTestId('cell')).getByTitle('ada@example.com');

      await act(async () => {
        fireEvent.click(screen.getByTestId('deny-email'));
      });
      await settle();

      // The same mounted label, relabelled in place — not a remount.
      expect(within(screen.getByTestId('cell')).getByTitle('Ada Lovelace')).toBe(label);
      expect(screen.getByTestId('cell').innerHTML).not.toContain('ada@example.com');
    }

    it('an expanded record', async () => {
      await relabels(makeDataSource('rg_person_late', { titleFormat: '{email}' }), 'rg_person_late', ADA);
    });

    it('a bare id fetched on demand', async () => {
      const ds = makeDataSource('rg_person_late_fetch', { titleFormat: '{email}' }, PEOPLE);
      await relabels(ds, 'rg_person_late_fetch', 'p1');
      // Relabelling re-reads the policy, not the backend.
      expect(ds.findOne).toHaveBeenCalledTimes(1);
    });
  });
});

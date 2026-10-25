/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A lookup value hydrated from a bare id takes its label from the referenced
 * object's schema once that schema arrives — objectui#10487.
 *
 * A lookup that mounts holding a stored id fetches that record to label its
 * chip, and asks for the referenced object's schema at the same time. Nothing
 * orders the two. When the record came back first, the chip was labelled on
 * the no-schema path (the `name` guess) and kept that label for good: the
 * hydration cached a BUILT option, its label frozen, and the schema's arrival
 * never rebuilt it. The dropdown derives its options from their rows on every
 * render, so it read the object's declared `nameField` for the same record,
 * and one record read two ways side by side — the common edit-form state.
 *
 * The fixture forces that order: the record fetch resolves while the schema
 * request is held open, and the schema is released only after the chip has
 * been labelled. Every row carries a `name` value, so a label frozen on the
 * no-schema path cannot pass. Pinned:
 *
 *  - the mounted chip reads the declared `nameField` once the schema
 *    resolves, on the single-id `findOne` path and on the batched `$in` path;
 *    the record is fetched once — the schema's arrival relabels, it does not
 *    re-fetch;
 *  - the other order, the schema arriving while the record fetch is still in
 *    flight: the chip reads the same text from one fetch. It used to take two
 *    — the schema's arrival changed a field the hydration effect listed but no
 *    longer reads, which cancelled the fetch in flight and issued another;
 *  - the same derivation reads the permission policy in force now: a field the
 *    policy denies after the chip is labelled leaves the label, as it leaves
 *    the dropdown's (objectui#10373);
 *  - control: the dropdown option for the same record reads the same text;
 *  - control: picking the same record from the dropdown leaves the chip on the
 *    same text.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererContext } from '@object-ui/react';
import { PermissionProvider } from '@object-ui/permissions';
import { LookupField } from './LookupField';

const CONTRACT_FIELDS: Record<string, unknown> = {
  contract_no: { type: 'text', label: 'Contract No' },
  name: { type: 'text', label: 'Name' },
};

const ROWS: Record<string, unknown>[] = [
  { id: 'c1', name: 'Acme', contract_no: 'HT-001' },
  { id: 'c2', name: 'Initech', contract_no: 'HT-002' },
];

/**
 * A backend whose `getObjectSchema` answers only when `releaseSchema()` is
 * called — so the test, not the scheduler, decides which of the two requests
 * wins. With `holdRecord`, `findOne` also answers only on `releaseRecord()`.
 */
function makeBackend({ holdRecord = false }: { holdRecord?: boolean } = {}) {
  let releaseSchema!: () => void;
  const schemaHeld = new Promise<void>((resolve) => {
    releaseSchema = resolve;
  });
  let releaseRecord!: () => void;
  const recordHeld = new Promise<void>((resolve) => {
    releaseRecord = resolve;
  });
  const find = vi.fn(async (objectName: string, params?: { $filter?: { id?: { $in?: unknown[] } } }) => {
    if (objectName !== 'contract') return { data: [], total: 0 };
    const wanted = params?.$filter?.id?.$in;
    const rows = wanted ? ROWS.filter((r) => wanted.includes(r.id)) : ROWS;
    return { data: rows.map((r) => ({ ...r })), total: rows.length };
  });
  const findOne = vi.fn(async (objectName: string, id: string) => {
    if (holdRecord) await recordHeld;
    const row = objectName === 'contract' ? ROWS.find((r) => r.id === id) : undefined;
    return row ? { ...row } : null;
  });
  const getObjectSchema = vi.fn(async (objectName: string) => {
    await schemaHeld;
    return objectName === 'contract'
      ? { name: 'contract', nameField: 'contract_no', fields: CONTRACT_FIELDS }
      : undefined;
  });
  return { ds: { find, findOne, getObjectSchema }, releaseSchema, releaseRecord };
}

type Backend = ReturnType<typeof makeBackend>['ds'];

/** Holds the value, so a pick commits and the chip re-resolves from it. */
function Host({ ds, initial, multiple = false }: { ds: Backend; initial: unknown; multiple?: boolean }) {
  const [value, setValue] = React.useState<unknown>(initial);
  return (
    <SchemaRendererContext.Provider value={{ dataSource: ds } as never}>
      <LookupField
        value={value}
        onChange={setValue}
        dataSource={ds as never}
        field={{ reference: 'contract', multiple } as never}
      />
    </SchemaRendererContext.Provider>
  );
}

/**
 * `Host` under the real role-based provider. The "Deny name" button makes
 * `name` a field the viewer may not read on `contract`, so the test can change
 * the policy in force after the chip is labelled, as a policy that loads late
 * does.
 */
function PolicyHost({ ds }: { ds: Backend }) {
  const [deny, setDeny] = React.useState<string[]>([]);
  return (
    <PermissionProvider
      roles={[]}
      userRoles={['viewer']}
      permissions={[
        {
          object: 'contract',
          roles: {
            viewer: { actions: ['read'], fieldPermissions: deny.map((field) => ({ field, read: false })) },
          },
        },
      ]}
    >
      <button type="button" onClick={() => setDeny(['name'])}>
        Deny name
      </button>
      <Host ds={ds} initial="c1" />
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

/** Each selected-value chip's label, read from its remove control's name. */
function chipLabels(): string[] {
  return screen
    .queryAllByRole('button', { name: /^Remove / })
    .map((b) => (b.getAttribute('aria-label') ?? '').replace(/^Remove /, ''));
}

/**
 * Mount holding `initial`, let the record fetch label the chip while the schema
 * is held, then release the schema. Returns the chip labels read at each
 * moment.
 */
async function mountHydrated(initial: unknown, multiple = false) {
  const { ds, releaseSchema } = makeBackend();
  render(<Host ds={ds} initial={initial} multiple={multiple} />);
  await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith('contract'));
  await waitFor(() => expect(chipLabels().length).toBeGreaterThan(0));
  await settle();
  const beforeSchema = chipLabels();
  await act(async () => {
    releaseSchema();
  });
  await settle();
  return { ds, beforeSchema, afterSchema: chipLabels() };
}

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    /* no storage in this environment */
  }
});

describe('LookupField — a hydrated value is labelled from the schema once it arrives (objectui#10487)', () => {
  it('a single hydrated id: the mounted chip reads the declared nameField after the schema resolves', async () => {
    const { ds, beforeSchema, afterSchema } = await mountHydrated('c1');
    // The fixture's order held: the chip was labelled before the schema existed.
    expect(beforeSchema).toEqual(['Acme']);
    expect(afterSchema).toEqual(['HT-001']);
    // The schema's arrival relabels the record already fetched; it does not
    // fetch it again.
    expect(ds.findOne).toHaveBeenCalledTimes(1);
    expect(ds.findOne).toHaveBeenCalledWith('contract', 'c1');
  });

  it('several hydrated ids (the batched $in path): every chip reads the declared nameField after the schema resolves', async () => {
    const { ds, beforeSchema, afterSchema } = await mountHydrated(['c1', 'c2'], true);
    expect(beforeSchema).toEqual(['Acme', 'Initech']);
    expect(afterSchema).toEqual(['HT-001', 'HT-002']);
    const batched = ds.find.mock.calls.filter(([, params]) => params?.$filter?.id?.$in);
    expect(batched).toHaveLength(1);
  });

  it('the schema arrives while the record fetch is in flight: one fetch, and the chip reads the declared nameField', async () => {
    const { ds, releaseSchema, releaseRecord } = makeBackend({ holdRecord: true });
    render(<Host ds={ds} initial="c1" />);
    await waitFor(() => expect(ds.findOne).toHaveBeenCalledTimes(1));
    await act(async () => {
      releaseSchema();
    });
    await settle();
    await act(async () => {
      releaseRecord();
    });
    await settle();
    expect(chipLabels()).toEqual(['HT-001']);
    // The schema's arrival does not cancel the fetch in flight to issue another.
    expect(ds.findOne).toHaveBeenCalledTimes(1);
  });

  it('the same derivation follows the policy: a field denied after the chip is labelled leaves the label', async () => {
    // The schema is never released, so this row reads the no-schema path.
    const { ds } = makeBackend();
    render(<PolicyHost ds={ds} />);
    await waitFor(() => expect(chipLabels()).toEqual(['Acme']));
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Deny name' }));
    });
    await settle();
    // Nothing else on the row is nameable on this path, so the label falls
    // through to the id — the label the dropdown builds for the same row.
    expect(chipLabels()).toEqual(['c1']);
    expect(ds.findOne).toHaveBeenCalledTimes(1);
  });

  it('control: the dropdown option for the same record reads the declared nameField', async () => {
    await mountHydrated('c1');
    await act(async () => {
      fireEvent.click(screen.getByTestId('lookup-trigger'));
    });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    await settle();
    expect(screen.getAllByRole('option').map((el) => el.getAttribute('title'))).toEqual(['HT-001', 'HT-002']);
  });

  it('control: picking the same record from the dropdown leaves the chip on the declared nameField', async () => {
    await mountHydrated('c1');
    await act(async () => {
      fireEvent.click(screen.getByTestId('lookup-trigger'));
    });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    await settle();
    await act(async () => {
      fireEvent.click(screen.getAllByRole('option')[0]);
    });
    await settle();
    // The popover closed on the pick, so no option row supplies the text: the
    // chip reads the option the pick cached.
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(chipLabels()).toEqual(['HT-001']);
  });
});

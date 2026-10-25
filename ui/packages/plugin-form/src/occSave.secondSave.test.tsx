/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10565: the SECOND save from an edit form that stays open.
 *
 * Every layout hands `useOccSave` the record it READ as `baseRecord`, and none
 * of them refreshes it after a save. The hook used to send that read's
 * `updated_at` as `ifMatch` on every save. The first save moves the stored
 * `updated_at`, so the second save sent a token the server no longer holds and
 * was refused `409 CONCURRENT_UPDATE`: the user met the conflict dialog over
 * their own earlier save.
 *
 * ── The double, and why it is shaped this way ─────────────────────────────
 * `enforcingDataSource` stands in for the adapter over a server that enforces
 * `ifMatch`. Its rule and its shapes were taken from one measurement against a
 * real ObjectStack stack (the reading is on objectui#10565; nothing here
 * re-derives it):
 *   - no token → no check; a token naming another instant → 409;
 *   - every accepted write stamps a strictly later `updated_at`
 *     (ISO-8601 with milliseconds and `Z`) and returns the whole record,
 *     which is what the adapter's `update` resolves with;
 *   - a refusal carries the measured 409 body, built into an `Error` the way
 *     `@objectstack/client` builds one and passed through the adapter's real
 *     `normaliseClientError`, so the hook sees the error the adapter throws.
 *
 * ── Direction of these pins ───────────────────────────────────────────────
 *  - the single-save control is GREEN before and after;
 *  - every row that makes a second save from the same read is RED before the
 *    fix: it asserts the token that save sent.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { normaliseClientError } from '@object-ui/data-objectstack';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from './ObjectForm';
import type { DataSource } from '@object-ui/types';
import { useOccSave, type OccSaveArgs, type OccSaveOutcome } from './occSave';

registerAllFields();

const OBJECT = 'device';
/** The measured spelling of a version: ISO-8601, milliseconds, `Z`. */
const READ_VERSION = '2026-09-25T13:12:11.097Z';

type Row = Record<string, unknown>;

/** The 409 the adapter throws for the measured wire body. */
function concurrentUpdate(object: string, id: string, row: Row, expected: string) {
  const current = String(row.updated_at);
  const body = {
    error: `Record ${object}/${id} was modified by another user (current version ${current}, expected ${expected})`,
    code: 'CONCURRENT_UPDATE',
    currentVersion: current,
    currentRecord: { ...row },
    object,
  };
  // `@objectstack/client`: message from the body's `error` string, `code`
  // from the body, `httpStatus` from the response, and the whole body as
  // `details` because it carries no `details` of its own.
  return normaliseClientError(
    Object.assign(new Error(body.error), { code: body.code, httpStatus: 409, details: body }),
  );
}

function enforcingDataSource(rows: Record<string, Row>) {
  let clock = Date.parse(READ_VERSION);
  const stamp = () => new Date((clock += 1_000)).toISOString();
  const update = vi.fn(
    async (object: string, id: string | number, data: Row, opts?: { ifMatch?: string }) => {
      const row = rows[String(id)];
      const expected = opts?.ifMatch;
      if (expected && Date.parse(expected) !== Date.parse(String(row.updated_at))) {
        throw concurrentUpdate(object, String(id), row, expected);
      }
      Object.assign(row, data, { updated_at: stamp() });
      return { ...row };
    },
  );
  return {
    dataSource: {
      getObjectSchema: vi.fn(async () => ({
        name: OBJECT,
        fields: { name: { type: 'text', label: 'Name' } },
      })),
      findOne: vi.fn(async (_o: string, id: string | number) => ({ ...rows[String(id)] })),
      create: vi.fn(),
      update,
    },
    /** The `ifMatch` each `update` call carried, in call order. */
    sent: () => update.mock.calls.map((c) => c[3]?.ifMatch),
    /** Someone else saves the record, outside this form. */
    otherWriter: (id: string, data: Row) => {
      Object.assign(rows[id], data, { updated_at: stamp() });
    },
  };
}

const rowsOf = (...ids: string[]): Record<string, Row> =>
  Object.fromEntries(ids.map((id) => [id, { id, name: 'Mine', updated_at: READ_VERSION }]));

/** The smallest honest host: the real hook, its real dialog, nothing between. */
function mountHook() {
  const handle: { save?: (args: OccSaveArgs) => Promise<OccSaveOutcome> } = {};
  const Host: React.FC = () => {
    const { saveWithOcc, conflictDialog } = useOccSave();
    handle.save = saveWithOcc;
    return <>{conflictDialog}</>;
  };
  render(<Host />);
  /** Start a save without awaiting it: a refused one waits on the dialog. */
  return async (args: Omit<OccSaveArgs, 'objectName'>) => {
    let pending!: Promise<OccSaveOutcome>;
    await act(async () => {
      pending = handle.save!({ objectName: OBJECT, ...args });
    });
    return pending;
  };
}

/**
 * A save the test expects to land. A refused save waits on the conflict
 * dialog and never settles, so the dialog opening is the failure, not a hang.
 */
async function landed(pending: Promise<OccSaveOutcome>) {
  const outcome = await Promise.race([
    pending,
    screen.findByText('Keep editing').then(() => {
      throw new Error('the conflict dialog opened: the save was refused 409');
    }),
  ]);
  expect(outcome.status).toBe('saved');
  return (outcome as { status: 'saved'; result: Row }).result;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useOccSave: the version the last write returned is the next save\'s token (#10565)', () => {
  it('control: a single save sends the updated_at the form read, and lands', async () => {
    const { dataSource, sent } = enforcingDataSource(rowsOf('r1'));
    const save = mountHook();
    const read = await dataSource.findOne(OBJECT, 'r1');

    const result = await landed(save({ dataSource, recordId: 'r1', payload: { name: 'v2' }, baseRecord: read }));

    expect(sent()).toEqual([READ_VERSION]);
    expect(result.name).toBe('v2');
  });

  it('the second save from the same read sends the version the first write returned, and lands', async () => {
    const { dataSource, sent } = enforcingDataSource(rowsOf('r1'));
    const save = mountHook();
    const read = await dataSource.findOne(OBJECT, 'r1');

    const first = await landed(save({ dataSource, recordId: 'r1', payload: { name: 'v2' }, baseRecord: read }));
    const second = save({ dataSource, recordId: 'r1', payload: { name: 'v3' }, baseRecord: read });

    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(2));
    expect(sent()[1]).toBe(first.updated_at);
    expect((await landed(second)).name).toBe('v3');
    expect(screen.queryByText('Keep editing')).toBeNull();
  });

  it('a third save sends what the SECOND write returned: the last write, not the first', async () => {
    const { dataSource, sent } = enforcingDataSource(rowsOf('r1'));
    const save = mountHook();
    const read = await dataSource.findOne(OBJECT, 'r1');

    await landed(save({ dataSource, recordId: 'r1', payload: { name: 'v2' }, baseRecord: read }));
    const second = await landed(save({ dataSource, recordId: 'r1', payload: { name: 'v3' }, baseRecord: read }));
    await landed(save({ dataSource, recordId: 'r1', payload: { name: 'v4' }, baseRecord: read }));

    expect(sent()[2]).toBe(second.updated_at);
  });

  it('another writer between the two saves still earns the conflict dialog', async () => {
    const { dataSource, sent, otherWriter } = enforcingDataSource(rowsOf('r1'));
    const save = mountHook();
    const read = await dataSource.findOne(OBJECT, 'r1');

    const first = await landed(save({ dataSource, recordId: 'r1', payload: { name: 'v2' }, baseRecord: read }));
    otherWriter('r1', { name: 'Theirs' });
    const second = save({ dataSource, recordId: 'r1', payload: { name: 'v3' }, baseRecord: read });

    fireEvent.click(await screen.findByText('Keep editing'));
    expect(await second).toEqual({ status: 'cancelled' });
    // The guard fired on the token this form last wrote, not on its stale read.
    expect(sent()).toEqual([READ_VERSION, first.updated_at]);
  });

  it('after Overwrite, the next save sends the version the overwrite returned', async () => {
    const { dataSource, sent, otherWriter } = enforcingDataSource(rowsOf('r1'));
    const save = mountHook();
    const read = await dataSource.findOne(OBJECT, 'r1');
    otherWriter('r1', { name: 'Theirs' });

    const first = save({ dataSource, recordId: 'r1', payload: { name: 'v2' }, baseRecord: read });
    fireEvent.click(await screen.findByText('Overwrite'));
    const overwritten = await landed(first);
    const next = await landed(save({ dataSource, recordId: 'r1', payload: { name: 'v3' }, baseRecord: read }));

    expect(sent()[2]).toBe(overwritten.updated_at);
    expect(next.name).toBe('v3');
  });

  it('a newer read of the record wins over the remembered version', async () => {
    const { dataSource, sent, otherWriter } = enforcingDataSource(rowsOf('r1'));
    const save = mountHook();
    const read = await dataSource.findOne(OBJECT, 'r1');

    await landed(save({ dataSource, recordId: 'r1', payload: { name: 'v2' }, baseRecord: read }));
    otherWriter('r1', { name: 'Theirs' });
    const reread = await dataSource.findOne(OBJECT, 'r1');
    await landed(save({ dataSource, recordId: 'r1', payload: { name: 'v3' }, baseRecord: reread }));

    expect(sent()[1]).toBe(reread.updated_at);
  });

  it('a version is remembered per record: another record sends its own read', async () => {
    const { dataSource, sent } = enforcingDataSource(rowsOf('r1', 'r2'));
    const save = mountHook();
    const read1 = await dataSource.findOne(OBJECT, 'r1');
    const read2 = await dataSource.findOne(OBJECT, 'r2');

    await landed(save({ dataSource, recordId: 'r1', payload: { name: 'v2' }, baseRecord: read1 }));
    await landed(save({ dataSource, recordId: 'r2', payload: { name: 'v2' }, baseRecord: read2 }));

    expect(sent()[1]).toBe(read2.updated_at);
  });

  it('a read without updated_at stays unguarded, even after a write returns one', async () => {
    const { dataSource, sent } = enforcingDataSource(rowsOf('r1'));
    const save = mountHook();
    const read = { id: 'r1', name: 'Mine' };

    await landed(save({ dataSource, recordId: 'r1', payload: { name: 'v2' }, baseRecord: read }));
    await landed(save({ dataSource, recordId: 'r1', payload: { name: 'v3' }, baseRecord: read }));

    expect(sent()).toEqual([undefined, undefined]);
  });

  it('a write result carrying no version: the next save falls back to the read', async () => {
    // Not the measured server: a data source whose `update` resolves without
    // the record's version. Nothing is invented in its place.
    const update = vi.fn(async (_o: string, id: string | number, d: Row, _opts?: { ifMatch?: string }) => ({ id, ...d }));
    const save = mountHook();
    const read = { id: 'r1', name: 'Mine', updated_at: READ_VERSION };

    await landed(save({ dataSource: { update }, recordId: 'r1', payload: { name: 'v2' }, baseRecord: read }));
    await landed(save({ dataSource: { update }, recordId: 'r1', payload: { name: 'v3' }, baseRecord: read }));

    expect(update.mock.calls.map((c) => c[3]?.ifMatch)).toEqual([READ_VERSION, READ_VERSION]);
  });
});

describe('ObjectForm edit: two submits from one mounted form (#10565)', () => {
  it('the second submit carries the first write\'s version and lands without the dialog', async () => {
    const { dataSource, sent } = enforcingDataSource(rowsOf('r1'));
    const onSuccess = vi.fn();
    const { container } = render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: OBJECT, mode: 'edit', recordId: 'r1', onSuccess }}
        dataSource={dataSource as unknown as DataSource}
      />,
    );
    const input = await waitFor(() => {
      const el = container.querySelector('input[name="name"]') as HTMLInputElement | null;
      if (!el) throw new Error('name not ready');
      return el;
    });

    fireEvent.change(input, { target: { value: 'v2' } });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    const first = onSuccess.mock.calls[0][0] as Row;

    fireEvent.change(input, { target: { value: 'v3' } });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(2));

    expect(sent()).toEqual([READ_VERSION, first.updated_at]);
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Keep editing')).toBeNull();
  });
});

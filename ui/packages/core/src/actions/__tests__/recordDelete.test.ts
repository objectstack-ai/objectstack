/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The shared record-delete core (objectui#10383), pinned at the unit
 * level: the question, the single delete, the bulk delete and the partial
 * failure — with the runner-facing result
 * shape each path returns, because the console registers `run` as its action
 * runner's `delete` handler and those shapes are what keep the runner from
 * toasting a second time.
 *
 * The translator echoes the key (plus `|defaultValue` when one is passed) so
 * each assertion names the copy it expects without depending on a pack.
 */

import { describe, it, expect, vi } from 'vitest';
import { recordDelete } from '../recordDelete';

const t = (key: string, options?: Record<string, unknown>) => {
  const vars = { ...(options ?? {}) };
  delete vars.defaultValue;
  const suffix = Object.keys(vars).length ? ` ${JSON.stringify(vars)}` : '';
  return `${key}${suffix}`;
};

function harness(opts: {
  objectName?: string;
  failIds?: string[];
} = {}) {
  const failIds = opts.failIds ?? [];
  const dataSource = {
    delete: vi.fn(async (_resource: string, id: string) => {
      if (failIds.includes(id)) throw new Error(`refused ${id}`);
      return true;
    }),
  };
  const toast = { success: vi.fn(), error: vi.fn() };
  const onRefresh = vi.fn();
  const deps = {
    objectName: opts.objectName ?? 'crm_lead',
    label: 'Lead',
    t,
    dataSource,
    toast,
    onRefresh,
  };
  return { deps, dataSource, toast, onRefresh };
}

describe('recordDelete.confirmText', () => {
  it('with no object named, keeps the question that says the delete is permanent', () => {
    expect(recordDelete.confirmText({ t })).toBe('objectActions.deleteConfirm');
  });
});

/**
 * objectui#11695 — the delete confirmation names what it deletes. The title
 * names ONE record by the ADR-0079 resolver (reading the object's declared
 * `nameField` when the host hands the definition) plus the object label, or
 * counts a batch; the confirm button is the delete verb, never the generic
 * "Continue"; the body is `confirmText`'s question.
 */
describe('recordDelete.confirmCopy (objectui#11695)', () => {
  const PRODUCT = {
    name: 'crm_product',
    label: 'Product',
    nameField: 'product_name',
    fields: { product_name: { type: 'text' }, name: { type: 'text' } },
  };

  it('names ONE record by its declared name field and the object label, and confirms with the delete verb', () => {
    const copy = recordDelete.confirmCopy(
      { objectName: 'crm_product', t, label: 'Product', objectDef: PRODUCT },
      { record: { id: 'p1', product_name: 'QA Widget 0', name: 'SKU-1' } },
    );
    expect(copy).toEqual({
      title: 'objectActions.deleteConfirmTitle {"label":"Product","name":"QA Widget 0"}',
      // A business object's delete goes to the recycle bin (ADR-0148): the
      // question alone, pinned with its platform control below.
      message: 'objectActions.deleteConfirmQuestion',
      confirmText: 'objectActions.deleteConfirmButton',
    });
  });

  it('without the definition, the resolver reads the record itself (control: the name field above was READ)', () => {
    const copy = recordDelete.confirmCopy(
      { objectName: 'crm_product', t, label: 'Product' },
      { record: { id: 'p1', product_name: 'QA Widget 0', name: 'SKU-1' } },
    );
    expect(copy.title).toBe('objectActions.deleteConfirmTitle {"label":"Product","name":"SKU-1"}');
  });

  it('a row with no name reads by the resolver floor, never a blank', () => {
    const copy = recordDelete.confirmCopy(
      { objectName: 'crm_product', t, label: 'Product', objectDef: PRODUCT },
      { record: { id: 'p9' } },
    );
    expect(copy.title).toBe('objectActions.deleteConfirmTitle {"label":"Product","name":"Record #p9"}');
  });

  it('counts a batch in the title and asks the batch question', () => {
    const copy = recordDelete.confirmCopy({ objectName: 'crm_lead', t, label: 'Lead' }, { count: 3 });
    expect(copy).toEqual({
      title: 'objectActions.bulkDeleteConfirmTitle {"count":3,"label":"Lead"}',
      message: 'console.objectView.bulkDeleteQuestion {"count":3}',
      confirmText: 'objectActions.deleteConfirmButton',
    });
  });
});

describe('recordDelete.run — one record', () => {
  it('deletes, refreshes, toasts success, and returns the silent success the runner expects', async () => {
    const { deps, dataSource, toast, onRefresh } = harness();
    const res = await recordDelete.run(deps, { params: { recordId: 'l1' } });

    expect(dataSource.delete).toHaveBeenCalledTimes(1);
    expect(dataSource.delete).toHaveBeenCalledWith('crm_lead', 'l1');
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('objectActions.deleteSuccess {"label":"Lead"}');
    expect(toast.error).not.toHaveBeenCalled();
    expect(res).toEqual({ success: true, reload: true, silent: true });
  });

  it('a refused delete toasts the failure with its message, does not refresh, and returns no `error`', async () => {
    const { deps, toast, onRefresh } = harness({ failIds: ['l1'] });
    const res = await recordDelete.run(deps, { params: { recordId: 'l1' } });

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('objectActions.deleteFailed {"label":"Lead"}', {
      description: 'refused l1',
    });
    expect(onRefresh).not.toHaveBeenCalled();
    expect(res).toEqual({ success: false });
  });

  it('reads the id off `params.record`, then a single `params.records` entry, then the legacy top-level `recordId`', async () => {
    const a = harness();
    await recordDelete.run(a.deps, { params: { record: { id: 'from-record' } } });
    expect(a.dataSource.delete).toHaveBeenCalledWith('crm_lead', 'from-record');

    const b = harness();
    await recordDelete.run(b.deps, { params: { records: [{ id: 'only-one' }] } });
    expect(b.dataSource.delete).toHaveBeenCalledWith('crm_lead', 'only-one');

    const c = harness();
    await recordDelete.run(c.deps, { recordId: 'legacy' });
    expect(c.dataSource.delete).toHaveBeenCalledWith('crm_lead', 'legacy');
  });

  it('with no id at all, deletes nothing and returns the `error` for the runner to report', async () => {
    const { deps, dataSource, toast } = harness();
    const res = await recordDelete.run(deps, { params: {} });

    expect(dataSource.delete).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(res).toEqual({ success: false, error: 'objectActions.noRecordId' });
  });
});

describe('recordDelete.run — several records', () => {
  it('deletes each record, refreshes once, and toasts ONE summary', async () => {
    const { deps, dataSource, toast, onRefresh } = harness();
    const res = await recordDelete.run(deps, {
      params: { records: [{ id: 'a' }, { id: 'b' }, { name: 'no id — skipped' }] },
    });

    expect(dataSource.delete).toHaveBeenCalledTimes(2);
    expect(dataSource.delete).toHaveBeenCalledWith('crm_lead', 'a');
    expect(dataSource.delete).toHaveBeenCalledWith('crm_lead', 'b');
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(
      'objectActions.bulkDeleteSuccess {"count":2,"label":"Lead"}',
    );
    expect(res).toEqual({ success: true, reload: true, silent: true });
  });

  it('a partial failure toasts "N deleted, M failed" once, still refreshes, and returns no `error`', async () => {
    const { deps, dataSource, toast, onRefresh } = harness({ failIds: ['b'] });
    const res = await recordDelete.run(deps, { params: { records: [{ id: 'a' }, { id: 'b' }] } });

    expect(dataSource.delete).toHaveBeenCalledTimes(2);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      'objectActions.bulkDeletePartial {"succeeded":1,"failed":1}',
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(res).toEqual({ success: false });
  });
});


/**
 * objectstack-ai/objectstack#27823 — the delete is permanent and the success
 * toast names what went. The name comes from the same ADR-0079 resolver the
 * confirm title reads; the resolver's `Record #id` floor is not a name, so a
 * nameless record keeps the object-label toast. A batch keeps its count.
 */
describe('recordDelete.successText and the one-record toast (objectstack#27823)', () => {
  const TASK = {
    name: 'crm_task',
    label: 'Task',
    nameField: 'subject',
    fields: { subject: { type: 'text' }, name: { type: 'text' } },
  };

  it('names the record by its declared name field and the object label', () => {
    expect(
      recordDelete.successText(
        { t, label: 'Task', objectDef: TASK },
        { id: 't1', subject: 'Website Relaunch', name: 'T-1' },
      ),
    ).toBe('objectActions.deletedNamed {"label":"Task","name":"Website Relaunch"}');
  });

  it('a record with nothing nameable keeps the object-label toast, never "Record #id"', () => {
    expect(recordDelete.successText({ t, label: 'Task', objectDef: TASK }, { id: 't9' })).toBe(
      'objectActions.deleteSuccess {"label":"Task"}',
    );
    expect(recordDelete.successText({ t, label: 'Task' }, null)).toBe('objectActions.deleteSuccess {"label":"Task"}');
  });

  it('run names the row it was handed in `params.record`', async () => {
    const { deps, toast } = harness();
    await recordDelete.run(
      { ...deps, label: 'Task', objectDef: TASK },
      { params: { recordId: 't1', record: { id: 't1', subject: 'Website Relaunch' } } },
    );
    expect(toast.success).toHaveBeenCalledWith('objectActions.deletedNamed {"label":"Task","name":"Website Relaunch"}');
  });

  it('control: a batch toast keeps its count and names no record', async () => {
    const { deps, toast } = harness();
    await recordDelete.run(
      { ...deps, label: 'Task', objectDef: TASK },
      { params: { records: [{ id: 'a', subject: 'One' }, { id: 'b', subject: 'Two' }] } },
    );
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('objectActions.bulkDeleteSuccess {"count":2,"label":"Task"}');
  });
});

/**
 * objectstack#30239 (ADR-0148) — a by-id delete of a business record goes to
 * the recycle bin. Its confirm asks the question alone; a platform object
 * keeps the permanent copy. The one-record toast carries an Undo ONLY when
 * the delete wrote an entry (`onRecycleBinEntry`) and the host passed
 * `restore`; the Undo restores that entry — never a create — and a refused
 * restore toasts its reason, not a generic failure.
 */
describe('recordDelete and the recycle bin (objectstack#30239)', () => {
  function binHarness(opts: { entryId?: string; restoreError?: unknown; withRestore?: boolean } = {}) {
    const dataSource = {
      delete: vi.fn(async (_resource: string, _id: string, o?: { onRecycleBinEntry?: (id: string) => void }) => {
        if (opts.entryId) o?.onRecycleBinEntry?.(opts.entryId);
        return true;
      }),
      create: vi.fn(),
    };
    const restore = vi.fn(async (_entryId: string) => {
      if (opts.restoreError) throw opts.restoreError;
      return { entryId: opts.entryId };
    });
    const toast = { success: vi.fn(), error: vi.fn() };
    const onRefresh = vi.fn();
    const deps = {
      objectName: 'crm_lead',
      label: 'Lead',
      t,
      dataSource,
      toast,
      onRefresh,
      ...(opts.withRestore === false ? {} : { restore }),
      refusalLabels: { objectLabel: (name: string) => (name === 'crm_account' ? 'Account' : undefined) },
    };
    return { deps, dataSource, restore, toast, onRefresh };
  }
  const ROW = { params: { recordId: 'l1', record: { id: 'l1', name: 'Ada' } } };

  it('a business object asks the question alone; a platform object keeps the permanent copy (one and batch)', () => {
    const business = recordDelete.confirmCopy({ objectName: 'crm_lead', t, label: 'Lead' }, { record: { id: 'l1' } });
    const platform = recordDelete.confirmCopy({ objectName: 'sys_user', t, label: 'User' }, { record: { id: 'u1' } });
    expect(business.message).toBe('objectActions.deleteConfirmQuestion');
    expect(platform.message).toBe('objectActions.deleteConfirm');
    expect(recordDelete.confirmCopy({ objectName: 'crm_lead', t, label: 'Lead' }, { count: 2 }).message)
      .toBe('console.objectView.bulkDeleteQuestion {"count":2}');
    for (const name of ['sys_user', 'cloud_plan', 'ai_agent']) {
      expect(recordDelete.confirmCopy({ objectName: name, t, label: 'X' }, { count: 2 }).message)
        .toBe('console.objectView.bulkDeleteConfirm {"count":2}');
    }
  });

  it('round trip: the toast carries Undo, which restores the entry (never a create), refreshes and names the record', async () => {
    const { deps, dataSource, restore, toast, onRefresh } = binHarness({ entryId: 'rb1' });
    const res = await recordDelete.run(deps, ROW);
    expect(res).toEqual({ success: true, reload: true, silent: true });
    expect(dataSource.delete).toHaveBeenCalledWith('crm_lead', 'l1', { onRecycleBinEntry: expect.any(Function) });

    expect(toast.success).toHaveBeenCalledTimes(1);
    const [message, data] = toast.success.mock.calls[0];
    expect(message).toBe('objectActions.deletedNamed {"label":"Lead","name":"Ada"}');
    expect(data.action.label).toBe('actions.undo');
    expect(restore).not.toHaveBeenCalled();

    data.action.onClick();
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2));
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith('rb1');
    expect(dataSource.create).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(toast.success.mock.calls[1]).toEqual(['objectActions.restoredNamed {"label":"Lead","name":"Ada"}']);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a refused undo toasts the refusal sentence for its code, not the server message', async () => {
    const refusal = Object.assign(new Error('raw server text'), {
      code: 'RESTORE_PARENT_IN_RECYCLE_BIN',
      details: { object: 'crm_lead', parentObject: 'crm_account', parentId: 'a1', parentEntryId: 'rb0' },
    });
    const { deps, toast, onRefresh } = binHarness({ entryId: 'rb1', restoreError: refusal });
    await recordDelete.run(deps, ROW);
    toast.success.mock.calls[0][1].action.onClick();
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith('objectActions.restoreFailed {"label":"Lead"}', {
      description: 'recycleBin.refusal.parentInRecycleBin {"object":"crm_lead","parent":"Account","field":""}',
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('control: an undo refused with a code nobody names keeps the server message', async () => {
    const other = Object.assign(new Error('raw server text'), { code: 'SOMETHING_ELSE' });
    const { deps, toast } = binHarness({ entryId: 'rb1', restoreError: other });
    await recordDelete.run(deps, ROW);
    toast.success.mock.calls[0][1].action.onClick();
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith('objectActions.restoreFailed {"label":"Lead"}', { description: 'raw server text' });
  });

  it('control: a delete whose answer carries no entry keeps today\'s toast, byte for byte', async () => {
    const { deps, toast } = binHarness({ entryId: undefined });
    await recordDelete.run(deps, ROW);
    expect(toast.success.mock.calls).toEqual([['objectActions.deletedNamed {"label":"Lead","name":"Ada"}']]);
  });

  it('control: a host with no restore deletes exactly as before and offers no Undo', async () => {
    const { deps, dataSource, toast } = binHarness({ entryId: 'rb1', withRestore: false });
    await recordDelete.run(deps, ROW);
    expect(dataSource.delete.mock.calls).toEqual([['crm_lead', 'l1']]);
    expect(toast.success.mock.calls).toEqual([['objectActions.deletedNamed {"label":"Lead","name":"Ada"}']]);
  });

  it('control: a batch keeps its summary toast with no Undo', async () => {
    const { deps, toast } = binHarness({ entryId: 'rb1' });
    await recordDelete.run(deps, { params: { records: [{ id: 'a' }, { id: 'b' }] } });
    expect(toast.success.mock.calls).toEqual([['objectActions.bulkDeleteSuccess {"count":2,"label":"Lead"}']]);
  });
});

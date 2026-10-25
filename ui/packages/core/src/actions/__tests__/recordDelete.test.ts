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
  it('asks the plain delete question', () => {
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
      message: 'objectActions.deleteConfirm',
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
      message: 'console.objectView.bulkDeleteConfirm {"count":3}',
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


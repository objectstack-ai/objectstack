/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Change Owner in the Console (objectstack#35403): when the action is offered,
 * what the dialog sends, and how its answers read.
 *
 * Visibility is three facts — the object is structurally eligible, its switch
 * `userActions.transfer` is on (both the spec's `resolveUserActionTransfer`),
 * and the explain engine's `transfer` verdict for the record is a definite
 * allow. The verdict is seeded into the record page's one cache, exactly as the
 * page payload seeds it, so no request leaves the test. Each case below holds
 * the verdict at `true` (a platform admin, a `modifyAllRecords` holder) where
 * the case is about the object, so only the object's own facts can take the
 * action away.
 *
 * `t()` answers its key followed by its options as JSON; the user picker is a
 * plain input standing in for the lazy `user` widget. The queue picker is the
 * real lazy `lookup` widget (objectstack#36395), so its search is the one the
 * console sends.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, screen, fireEvent, waitFor, within, act, cleanup } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/i18n')>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
    language: 'en',
  }),
  useObjectLabel: () => ({
    objectLabel: (def: { label: string }) => def.label,
    fieldLabel: (_o: string, _f: string, fallback: string) => fallback,
  }),
}));

vi.mock('@object-ui/fields', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/fields')>();
  const Stub = ({ id, value, onChange, readonly, field }: any) =>
    readonly ? (
      <span data-testid={`readonly-${field?.name}`}>{String(value ?? '')}</span>
    ) : (
      <input id={id} data-testid={`widget-${id}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    );
  return {
    ...actual,
    getLazyFieldWidget: (type: string) => (type === 'lookup' ? actual.getLazyFieldWidget(type) : Stub),
  };
});

import { AdapterCtx, MetadataCtx, SchemaRendererContext } from '@object-ui/react';
import { seedRecordVerdict } from '@object-ui/plugin-detail';
import { FormOwnerLine } from '@object-ui/plugin-form';
import { FormOwnerChangeAction } from './FormOwnerChangeAction';
import { ConsoleFormOwnerLine } from './consoleFormOwnerLine';
import { ChangeOwnerDialog } from './ChangeOwnerDialog';
import { readChangeOwnerReport, useListChangeOwnerOffered, __clearObjectTransferVerdicts } from './changeOwner';
import { seedRecordPageReaders } from './recordPagePayload';

const ALLOW = { allowed: true, record: { recordId: 'x', visible: true } };
const DENY = { allowed: false, record: { recordId: 'x', visible: true } };

let seq = 0;
/** A fresh record id per case, so each case reads only the verdict it seeds. */
function freshId(): string {
  seq += 1;
  return `r35403_${seq}`;
}

function noClient() {
  return { getClient: () => ({ data: {} }), find: vi.fn() } as any;
}

/**
 * Draw the form's Change Owner action for `objectSchema` with the record's
 * `transfer` verdict seeded as `decision`, and settle the verdict.
 */
async function mountAction(objectSchema: Record<string, unknown>, decision: unknown = ALLOW) {
  const recordId = freshId();
  const objectName = String(objectSchema.name);
  const verdict = Promise.resolve(decision);
  seedRecordVerdict(null, objectName, recordId, 'transfer', verdict);
  render(
    <AdapterCtx.Provider value={noClient()}>
      <FormOwnerChangeAction
        objectName={objectName}
        recordId={recordId}
        record={{ id: recordId, owner_id: 'u_amy' }}
        objectSchema={objectSchema}
      />
    </AdapterCtx.Provider>,
  );
  await act(async () => { await verdict; });
  return recordId;
}

const action = () => screen.queryByTestId('form-owner-change');

describe('Change Owner is offered only where the object offers it (objectstack#35403)', () => {
  it('a person-owned object, with the transfer verdict, offers it (the positive control)', async () => {
    await mountAction({ name: 'crm_deal', fields: { owner_id: { type: 'lookup' } } });
    await waitFor(() => expect(action()).not.toBeNull());
  });

  it("ownership: 'none' offers nothing, even to a platform admin", async () => {
    await mountAction({ name: 'crm_tag', ownership: 'none', fields: {} });
    expect(action()).toBeNull();
  });

  it('a managedBy object offers nothing, even to a platform admin', async () => {
    await mountAction({ name: 'auth_session', managedBy: 'better-auth', fields: {} });
    expect(action()).toBeNull();
  });

  it('a sys_* object offers nothing, even to a platform admin', async () => {
    await mountAction({ name: 'sys_queue', fields: {} });
    expect(action()).toBeNull();
  });

  it('a controlled_by_parent detail offers nothing by default …', async () => {
    await mountAction({ name: 'crm_deal_line', sharingModel: 'controlled_by_parent', fields: {} });
    expect(action()).toBeNull();
  });

  it('… and offers it once the detail turns userActions.transfer on', async () => {
    await mountAction({
      name: 'crm_deal_line',
      sharingModel: 'controlled_by_parent',
      userActions: { transfer: true },
      fields: {},
    });
    await waitFor(() => expect(action()).not.toBeNull());
  });

  it('a private object that switched transfer off offers nothing to a modifyAllRecords holder', async () => {
    await mountAction({ name: 'crm_contract', sharingModel: 'private', userActions: { transfer: false }, fields: {} });
    expect(action()).toBeNull();
  });

  it('a caller the explain engine refuses transfer (edit without transfer) is offered nothing', async () => {
    await mountAction({ name: 'crm_deal', fields: {} }, DENY);
    expect(action()).toBeNull();
  });

  it('a verdict not yet answered offers nothing (the action is drawn on a definite allow only)', async () => {
    const recordId = freshId();
    seedRecordVerdict(null, 'crm_deal', recordId, 'transfer', new Promise(() => {}));
    render(
      <AdapterCtx.Provider value={noClient()}>
        <FormOwnerChangeAction objectName="crm_deal" recordId={recordId} record={{ id: recordId }} objectSchema={{ name: 'crm_deal' }} />
      </AdapterCtx.Provider>,
    );
    expect(action()).toBeNull();
  });
});

describe("the record page's one read answers the transfer verdict (objectstack#35403)", () => {
  it("a payload that explains transfer seeds the verdict Change Owner reads: no second request", async () => {
    const recordId = freshId();
    const payload = Promise.resolve({ explain: { transfer: ALLOW } } as any);
    seedRecordPageReaders({
      payload,
      objectName: 'crm_deal',
      recordId,
      principal: null,
      related: [],
      explain: ['transfer'],
      fieldAccess: false,
      approvals: false,
    });
    render(
      <AdapterCtx.Provider value={noClient()}>
        <FormOwnerChangeAction objectName="crm_deal" recordId={recordId} record={{ id: recordId }} objectSchema={{ name: 'crm_deal' }} />
      </AdapterCtx.Provider>,
    );
    await waitFor(() => expect(action()).not.toBeNull());
  });
});

describe('the default edit form shows the owner read-only, with the action beside it (objectstack#35403)', () => {
  function mountForm(recordId: string, schema: Record<string, unknown>, host = true) {
    const line = (
      <FormOwnerLine
        mode="edit"
        objectName="crm_deal"
        recordId={recordId}
        record={{ id: recordId, owner_id: 'u_amy' }}
        objectSchema={schema}
      />
    );
    render(
      <AdapterCtx.Provider value={noClient()}>
        {host ? <ConsoleFormOwnerLine>{line}</ConsoleFormOwnerLine> : line}
      </AdapterCtx.Provider>,
    );
  }
  const SCHEMA = { name: 'crm_deal', fields: { owner_id: { type: 'lookup', label: 'Account Manager' } } };

  it('edit without transfer: the owner reads read-only under its own label, and no action is drawn', async () => {
    // Two lines in one tree: the refused record, and a control record the
    // verdict allows. The control's button proves the host's lazy action has
    // loaded and drawn, so the refused line's empty slot is the verdict's
    // answer and not a chunk still on its way.
    const denied = freshId();
    const control = freshId();
    seedRecordVerdict(null, 'crm_deal', denied, 'transfer', Promise.resolve(DENY));
    seedRecordVerdict(null, 'crm_deal', control, 'transfer', Promise.resolve(ALLOW));
    const line = (recordId: string) => (
      <div data-testid={`line-${recordId}`}>
        <FormOwnerLine mode="edit" objectName="crm_deal" recordId={recordId} record={{ id: recordId, owner_id: 'u_amy' }} objectSchema={SCHEMA} />
      </div>
    );
    render(
      <AdapterCtx.Provider value={noClient()}>
        <ConsoleFormOwnerLine>
          {line(denied)}
          {line(control)}
        </ConsoleFormOwnerLine>
      </AdapterCtx.Provider>,
    );
    const deniedLine = screen.getByTestId(`line-${denied}`);
    expect(within(deniedLine).getByText('Account Manager')).toBeTruthy();
    expect((await within(deniedLine).findByTestId('readonly-owner_id')).textContent).toBe('u_amy');
    expect(await within(screen.getByTestId(`line-${control}`)).findByTestId('form-owner-change')).toBeTruthy();
    expect(within(deniedLine).queryByRole('textbox')).toBeNull();
    expect(within(deniedLine).queryByTestId('form-owner-change')).toBeNull();
  });

  it('with the transfer verdict, Change Owner sits beside the read-only owner', async () => {
    const recordId = freshId();
    const verdict = Promise.resolve(ALLOW);
    seedRecordVerdict(null, 'crm_deal', recordId, 'transfer', verdict);
    mountForm(recordId, SCHEMA);
    const line = screen.getByTestId('form-owner-line');
    expect(await within(line).findByTestId('form-owner-change')).toBeTruthy();
    expect(within(line).getByTestId('readonly-owner_id')).toBeTruthy();
  });

  it('a form no host opts in draws no owner line (an embedded form is unchanged)', () => {
    mountForm(freshId(), SCHEMA, false);
    expect(screen.queryByTestId('form-owner-line')).toBeNull();
  });

  it('an object without owner_id draws no owner line', () => {
    mountForm(freshId(), { name: 'crm_deal', fields: { title: { type: 'text' } } });
    expect(screen.queryByTestId('form-owner-line')).toBeNull();
  });
});

describe('the Change Owner dialog sends the chosen target (objectstack#35403)', () => {
  let changeOwner: ReturnType<typeof vi.fn>;
  let changeOwnerMany: ReturnType<typeof vi.fn>;
  let find: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    changeOwner = vi.fn(async () => ({ object: 'crm_deal', id: 'd1', ownerId: 'u_bo' }));
    changeOwnerMany = vi.fn();
    find = vi.fn(async () => ({ data: [{ name: 'triage', label: 'Triage' }] }));
  });

  function mountDialog(records: Array<Record<string, unknown>>, objectDef: Record<string, unknown> = { name: 'crm_deal', fields: {} }) {
    const onOpenChange = vi.fn();
    const adapter = { getClient: () => ({ data: { changeOwner, changeOwnerMany } }), find } as any;
    render(
      <AdapterCtx.Provider value={adapter}>
        <ChangeOwnerDialog open onOpenChange={onOpenChange} objectDef={objectDef as any} records={records} />
      </AdapterCtx.Provider>,
    );
    return onOpenChange;
  }

  async function pickPerson(id: string) {
    fireEvent.change(await screen.findByTestId('widget-change_owner_target'), { target: { value: id } });
  }

  it('one record: data.changeOwner with the person picked and the notify flag', async () => {
    const onOpenChange = mountDialog([{ id: 'd1', owner_id: 'u_amy' }]);
    await pickPerson('u_bo');
    fireEvent.click(screen.getByTestId('change-owner-notify'));
    fireEvent.click(screen.getByTestId('change-owner-submit'));
    await waitFor(() => expect(changeOwner).toHaveBeenCalledTimes(1));
    expect(changeOwner).toHaveBeenCalledWith('crm_deal', 'd1', { ownerId: 'u_bo', notify: true });
    expect(changeOwnerMany).not.toHaveBeenCalled();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('one record: notify left unticked sends no notify flag', async () => {
    mountDialog([{ id: 'd1', owner_id: 'u_amy' }]);
    await pickPerson('u_bo');
    fireEvent.click(screen.getByTestId('change-owner-submit'));
    await waitFor(() => expect(changeOwner).toHaveBeenCalledWith('crm_deal', 'd1', { ownerId: 'u_bo' }));
  });

  it("one record: naming its current owner sends nothing and says why (N1)", async () => {
    mountDialog([{ id: 'd1', owner_id: 'u_amy' }]);
    await pickPerson('u_amy');
    expect(screen.getByTestId('change-owner-already-owner')).toBeTruthy();
    expect((screen.getByTestId('change-owner-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(changeOwner).not.toHaveBeenCalled();
  });

  it('one record: a refusal shows the server\'s own sentence', async () => {
    changeOwner.mockRejectedValueOnce(new Error('You may not transfer this record'));
    mountDialog([{ id: 'd1', owner_id: 'u_amy' }]);
    await pickPerson('u_bo');
    fireEvent.click(screen.getByTestId('change-owner-submit'));
    const refused = await screen.findByTestId('change-owner-refused');
    expect(refused.textContent).toContain('You may not transfer this record');
  });

  it('the dialog labels the picker with the object\'s own owner label', async () => {
    mountDialog([{ id: 'd1' }], { name: 'crm_deal', fields: { owner_id: { label: 'Account Manager' } } });
    expect(await screen.findByText('Account Manager')).toBeTruthy();
  });

  it('a list: data.changeOwnerMany with every id and the person, then each failed row drawn', async () => {
    changeOwnerMany.mockResolvedValueOnce({
      object: 'crm_deal',
      field: 'owner_id',
      ownerId: 'u_bo',
      updated: 2,
      failed: 2,
      failures: [
        { id: 'd3', code: 'PERMISSION_DENIED', message: 'not yours to move' },
        { id: 'd4', code: 'NOT_FOUND', message: 'gone' },
      ],
      notified: 0,
    });
    mountDialog([
      { id: 'd1', owner_id: 'u_amy' },
      { id: 'd2', owner_id: 'u_bo' },
      { id: 'd3', owner_id: 'u_cy' },
      { id: 'd4', owner_id: 'u_cy' },
    ]);
    await pickPerson('u_bo');
    fireEvent.click(screen.getByTestId('change-owner-submit'));
    const report = await screen.findByTestId('change-owner-report');
    expect(changeOwnerMany).toHaveBeenCalledWith('crm_deal', ['d1', 'd2', 'd3', 'd4'], { ownerId: 'u_bo' });
    expect(changeOwner).not.toHaveBeenCalled();
    // d2 already had u_bo: an echo the server counts as updated, read as unchanged.
    expect(within(report).getByText('console.changeOwner.report {"moved":1,"unchanged":1,"failed":2}')).toBeTruthy();
    const failures = within(report).getAllByTestId('change-owner-failure').map((li) => li.textContent);
    expect(failures).toEqual([
      'console.changeOwner.failure {"id":"d3","message":"not yours to move"}',
      'console.changeOwner.failure {"id":"d4","message":"gone"}',
    ]);
  });

  it('an object without the queue column offers no queue target', async () => {
    mountDialog([{ id: 'd1' }, { id: 'd2' }]);
    await screen.findByTestId('widget-change_owner_target');
    expect(screen.queryByTestId('change-owner-kind')).toBeNull();
  });
});

describe('the queue target is searched on the server, never cut at a page (objectstack#36395)', () => {
  const QUEUE_COUNT = 201;
  const QUEUES = Array.from({ length: QUEUE_COUNT }, (_, i) => {
    const n = String(i + 1).padStart(3, '0');
    return { id: `q_${n}`, name: `queue_${n}`, label: `Queue ${n}` };
  });

  /** `sys_queue` as the data API serves it: `$search`, `$filter`, `$top` and `$skip` honoured. */
  function queueBackend() {
    return vi.fn(async (objectName: string, params: Record<string, any> = {}) => {
      if (objectName !== 'sys_queue') return { data: [], total: 0 };
      let rows = QUEUES;
      const term = typeof params.$search === 'string' ? params.$search.toLowerCase() : '';
      if (term) rows = rows.filter((q) => q.label.toLowerCase().includes(term) || q.name.includes(term));
      const byName = params.$filter?.name;
      if (typeof byName === 'string') rows = rows.filter((q) => q.name === byName);
      else if (Array.isArray(byName?.$in)) rows = rows.filter((q) => byName.$in.includes(q.name));
      const skip = Number(params.$skip ?? 0);
      const top = Number(params.$top ?? rows.length);
      return { data: rows.slice(skip, skip + top).map((q) => ({ ...q })), total: rows.length };
    });
  }

  async function settle(ms = 0) {
    for (let i = 0; i < 6; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
    }
  }

  function mountQueueDialog(records: Array<Record<string, unknown>>) {
    const find = queueBackend();
    const changeOwner = vi.fn(async () => ({ object: 'crm_case', id: 'c1', queue: 'queue_201' }));
    const changeOwnerMany = vi.fn(async () => ({
      object: 'crm_case', field: 'owner_id', queue: 'queue_201', updated: 2, failed: 0, failures: [], notified: 0,
    }));
    const adapter = { getClient: () => ({ data: { changeOwner, changeOwnerMany } }), find } as any;
    render(
      <AdapterCtx.Provider value={adapter}>
        <SchemaRendererContext.Provider value={{ dataSource: adapter } as any}>
          <ChangeOwnerDialog
            open
            onOpenChange={vi.fn()}
            objectDef={{ name: 'crm_case', fields: { owner_id: {}, queue: { type: 'text' } } } as any}
            records={records}
          />
        </SchemaRendererContext.Provider>
      </AdapterCtx.Provider>,
    );
    return { find, changeOwner, changeOwnerMany };
  }

  const queueReads = (find: ReturnType<typeof vi.fn>) => find.mock.calls.filter((c) => c[0] === 'sys_queue').map((c) => c[1] ?? {});

  async function openQueuePicker() {
    fireEvent.click(screen.getByTestId('change-owner-kind-queue'));
    const trigger = await screen.findByTestId('lookup-trigger-change_owner_queue');
    await act(async () => { fireEvent.click(trigger); });
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
    await settle();
  }

  async function search(term: string) {
    await act(async () => { fireEvent.change(screen.getByRole('combobox'), { target: { value: term } }); });
    // Out past the picker's debounce, so the search is sent and answered.
    await settle(70);
  }

  it('reads nothing until the queue picker opens', async () => {
    const { find } = mountQueueDialog([{ id: 'c1' }, { id: 'c2' }]);
    fireEvent.click(screen.getByTestId('change-owner-kind-queue'));
    await screen.findByTestId('lookup-trigger-change_owner_queue');
    await settle();
    expect(queueReads(find)).toEqual([]);
  });

  it(`a list: the ${QUEUE_COUNT}st queue, past any first page, is found by a server search and picked`, async () => {
    const { find, changeOwnerMany } = mountQueueDialog([{ id: 'c1', owner_id: 'u_amy' }, { id: 'c2', owner_id: 'u_amy' }]);
    await openQueuePicker();
    // The first page does not hold it: the queue is reachable only by the search.
    expect(screen.queryByRole('option', { name: /Queue 201/ })).toBeNull();
    await search('Queue 201');
    expect(queueReads(find).some((p) => p.$search === 'Queue 201')).toBe(true);
    fireEvent.click(await screen.findByRole('option', { name: /Queue 201/ }));
    await settle();
    fireEvent.click(screen.getByTestId('change-owner-submit'));
    const report = await screen.findByTestId('change-owner-report');
    expect(changeOwnerMany).toHaveBeenCalledWith('crm_case', ['c1', 'c2'], { queue: 'queue_201' });
    expect(within(report).getByText('console.changeOwner.report {"moved":2,"unchanged":0,"failed":0}')).toBeTruthy();
  });

  it('one record: the searched queue is sent by its name, never its row id or label', async () => {
    const { changeOwner } = mountQueueDialog([{ id: 'c1', owner_id: 'u_amy' }]);
    await openQueuePicker();
    await search('Queue 201');
    fireEvent.click(await screen.findByRole('option', { name: /Queue 201/ }));
    await settle();
    fireEvent.click(screen.getByTestId('change-owner-submit'));
    await waitFor(() => expect(changeOwner).toHaveBeenCalledWith('crm_case', 'c1', { queue: 'queue_201' }));
  });
});

describe("a list asks the explain engine's transfer verdict for the object, once (objectstack#35403)", () => {
  let asked: Array<{ url: string; body: unknown }>;
  function stubExplain(allowed: unknown, ok = true) {
    asked = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      asked.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
      return { ok, status: ok ? 200 : 403, json: async () => ({ allowed }) };
    }));
  }
  beforeEach(() => __clearObjectTransferVerdicts());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('an allow offers the bulk entry, asked once at object grain (no recordId)', async () => {
    stubExplain(true);
    const def = { name: 'crm_deal', fields: {} };
    const first = renderHook(() => useListChangeOwnerOffered(def, true));
    await waitFor(() => expect(first.result.current).toBe(true));
    const second = renderHook(() => useListChangeOwnerOffered(def, true));
    await waitFor(() => expect(second.result.current).toBe(true));
    expect(asked).toEqual([{ url: '/api/v1/security/explain', body: { object: 'crm_deal', operation: 'transfer' } }]);
  });

  it('a refusal offers nothing', async () => {
    stubExplain(false);
    const { result } = renderHook(() => useListChangeOwnerOffered({ name: 'crm_deal', fields: {} }, true));
    await waitFor(() => expect(asked.length).toBe(1));
    await act(async () => {});
    expect(result.current).toBe(false);
  });

  it('no answer (a refused read) offers nothing', async () => {
    stubExplain(true, false);
    const { result } = renderHook(() => useListChangeOwnerOffered({ name: 'crm_deal', fields: {} }, true));
    await waitFor(() => expect(asked.length).toBe(1));
    await act(async () => {});
    expect(result.current).toBe(false);
  });

  it('no open selection asks nothing; opening one asks once, and reopening reads the kept answer', async () => {
    stubExplain(true);
    const def = { name: 'crm_deal', fields: {} };
    const { result, rerender } = renderHook(({ wanted }) => useListChangeOwnerOffered(def, wanted), {
      initialProps: { wanted: false },
    });
    await act(async () => {});
    expect(result.current).toBe(false);
    expect(asked).toEqual([]);
    rerender({ wanted: true });
    await waitFor(() => expect(result.current).toBe(true));
    rerender({ wanted: false });
    expect(result.current).toBe(false);
    rerender({ wanted: true });
    expect(result.current).toBe(true);
    await act(async () => {});
    expect(asked).toHaveLength(1);
  });

  it('an object that does not offer Change Owner asks nothing and offers nothing', async () => {
    stubExplain(true);
    const { result } = renderHook(() => useListChangeOwnerOffered({ name: 'crm_tag', ownership: 'none', fields: {} }, true));
    await act(async () => {});
    expect(result.current).toBe(false);
    expect(asked).toEqual([]);
  });
});

describe('how a bulk answer reads (objectstack#35403, carried nit N1)', () => {
  const rows = [
    { id: 'a', owner_id: 'u_bo' },
    { id: 'b', owner_id: { id: 'u_bo', name: 'Bo' } },
    { id: 'c', owner_id: 'u_amy' },
    { id: 'd', owner_id: 'u_bo' },
  ];

  it('a row that already named the person and did not fail reads unchanged, not moved', () => {
    const report = { updated: 3, failed: 1, failures: [{ id: 'd', code: 'PERMISSION_DENIED', message: 'no' }] };
    expect(readChangeOwnerReport(report, rows, { ownerId: 'u_bo' })).toEqual({ moved: 1, unchanged: 2, failed: 1 });
  });

  it('a queue target has no person to compare: every admitted row reads moved', () => {
    const report = { updated: 4, failed: 0, failures: [] };
    expect(readChangeOwnerReport(report, rows, { queue: 'triage' })).toEqual({ moved: 4, unchanged: 0, failed: 0 });
  });

  it('never reads more rows unchanged than the server counted updated', () => {
    const report = { updated: 1, failed: 0, failures: [] };
    expect(readChangeOwnerReport(report, rows, { ownerId: 'u_bo' })).toEqual({ moved: 0, unchanged: 1, failed: 0 });
  });
});

describe('the Change Owner dialog offers the declared cascades as ticks (objectstack#35315 phase 2)', () => {
  let changeOwner: ReturnType<typeof vi.fn>;
  let changeOwnerMany: ReturnType<typeof vi.fn>;
  let changeOwnerCascades: ReturnType<typeof vi.fn>;
  let explained: string[];

  /** The explain engine's object-level `transfer` verdict: allowed on `allow`, refused elsewhere. */
  function stubExplain(allow: string[]) {
    explained = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { object: string; operation: string };
      explained.push(`${body.object}:${body.operation}`);
      return { ok: true, status: 200, json: async () => ({ allowed: allow.includes(body.object) }) };
    }));
  }

  beforeEach(() => {
    __clearObjectTransferVerdicts();
    changeOwner = vi.fn(async () => ({ object: 'crm_account', id: 'a1', ownerId: 'u_bo', notified: false }));
    changeOwnerMany = vi.fn();
    changeOwnerCascades = vi.fn(async () => ({
      object: 'crm_account',
      cascades: [
        { object: 'crm_opportunity', field: 'account', label: 'Opportunity', fieldLabel: 'Account' },
        { object: 'crm_case', field: 'account', label: 'Case', fieldLabel: 'Account' },
      ],
    }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function mountDialog(records: Array<Record<string, unknown>> = [{ id: 'a1', owner_id: 'u_amy' }], objectDef: Record<string, unknown> = { name: 'crm_account', fields: { queue: { type: 'text' } } }) {
    const onOpenChange = vi.fn();
    const adapter = { getClient: () => ({ data: { changeOwner, changeOwnerMany, changeOwnerCascades } }), find: vi.fn(async () => ({ data: [] })) } as any;
    render(
      <AdapterCtx.Provider value={adapter}>
        <ChangeOwnerDialog open onOpenChange={onOpenChange} objectDef={objectDef as any} records={records} />
      </AdapterCtx.Provider>,
    );
    return onOpenChange;
  }

  it('lists only the declared cascades the explain engine allows the caller to transfer on', async () => {
    stubExplain(['crm_opportunity']);
    mountDialog();
    const list = await screen.findByTestId('change-owner-cascades');
    expect(changeOwnerCascades).toHaveBeenCalledWith('crm_account');
    expect(within(list).getByTestId('change-owner-cascade-crm_opportunity.account')).toBeTruthy();
    expect(within(list).queryByTestId('change-owner-cascade-crm_case.account')).toBeNull();
    expect(explained.sort()).toEqual(['crm_case:transfer', 'crm_opportunity:transfer']);
  });

  it('draws no cascade list when nothing is declared, or when the explain engine allows none', async () => {
    stubExplain([]);
    mountDialog();
    await waitFor(() => expect(explained).toHaveLength(2));
    await act(async () => {});
    expect(screen.queryByTestId('change-owner-cascades')).toBeNull();
    cleanup();
    stubExplain(['crm_opportunity', 'crm_case']);
    changeOwnerCascades.mockResolvedValueOnce({ object: 'crm_account', cascades: [] });
    mountDialog();
    await waitFor(() => expect(changeOwnerCascades).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(screen.queryByTestId('change-owner-cascades')).toBeNull();
    expect(explained).toEqual([]);
  });

  it('a ticked cascade reaches the request; an unticked one does not', async () => {
    stubExplain(['crm_opportunity', 'crm_case']);
    mountDialog();
    await screen.findByTestId('change-owner-cascade-crm_case.account');
    fireEvent.change(await screen.findByTestId('widget-change_owner_target'), { target: { value: 'u_bo' } });
    fireEvent.click(screen.getByTestId('change-owner-cascade-crm_opportunity.account'));
    fireEvent.click(screen.getByTestId('change-owner-submit'));
    await waitFor(() => expect(changeOwner).toHaveBeenCalledTimes(1));
    expect(changeOwner).toHaveBeenCalledWith('crm_account', 'a1', {
      ownerId: 'u_bo',
      cascade: [{ object: 'crm_opportunity', field: 'account' }],
    });
  });

  it('a bulk change carries the ticks too, and draws each cascade outcome with every refused row', async () => {
    stubExplain(['crm_opportunity']);
    changeOwnerMany.mockResolvedValueOnce({
      object: 'crm_account', field: 'owner_id', ownerId: 'u_bo', updated: 2, failed: 0, failures: [], notified: false,
      cascade: [{
        object: 'crm_opportunity', field: 'account', updated: 3, failed: 1, remaining: 4,
        failures: [{ id: 'o9', code: 'PERMISSION_DENIED', message: 'not yours to move' }],
      }],
    });
    mountDialog([{ id: 'a1', owner_id: 'u_amy' }, { id: 'a2', owner_id: 'u_cy' }]);
    fireEvent.click(await screen.findByTestId('change-owner-cascade-crm_opportunity.account'));
    fireEvent.change(await screen.findByTestId('widget-change_owner_target'), { target: { value: 'u_bo' } });
    fireEvent.click(screen.getByTestId('change-owner-submit'));
    const report = await screen.findByTestId('change-owner-cascade-report');
    expect(changeOwnerMany).toHaveBeenCalledWith('crm_account', ['a1', 'a2'], {
      ownerId: 'u_bo',
      cascade: [{ object: 'crm_opportunity', field: 'account' }],
    });
    expect(within(report).getByText('console.changeOwner.cascadeReport {"object":"Opportunity","field":"Account","moved":3,"failed":1}')).toBeTruthy();
    expect(within(report).getByText('console.changeOwner.cascadeRemaining {"count":4}')).toBeTruthy();
    expect(within(report).getAllByTestId('change-owner-cascade-failure').map((li) => li.textContent)).toEqual([
      'console.changeOwner.failure {"id":"o9","message":"not yours to move"}',
    ]);
  });

  it('one record whose cascade left a row behind keeps the dialog open on the report instead of a toast', async () => {
    stubExplain(['crm_opportunity']);
    changeOwner.mockResolvedValueOnce({
      object: 'crm_account', id: 'a1', ownerId: 'u_bo', notified: false,
      cascade: [{ object: 'crm_opportunity', field: 'account', updated: 0, failed: 1, remaining: 0, failures: [{ id: 'o1', code: 'PERMISSION_DENIED', message: 'no' }] }],
    });
    const onOpenChange = mountDialog();
    fireEvent.click(await screen.findByTestId('change-owner-cascade-crm_opportunity.account'));
    fireEvent.change(await screen.findByTestId('widget-change_owner_target'), { target: { value: 'u_bo' } });
    fireEvent.click(screen.getByTestId('change-owner-submit'));
    await screen.findByTestId('change-owner-cascade-report');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('a queue target asks for no cascade', async () => {
    stubExplain(['crm_opportunity']);
    mountDialog();
    await screen.findByTestId('change-owner-cascades');
    fireEvent.click(screen.getByTestId('change-owner-kind-queue'));
    await act(async () => {});
    expect(screen.queryByTestId('change-owner-cascades')).toBeNull();
  });
});

describe('the queue target offers the queues an app declares beside sys_queue (objectstack#36807)', () => {
  /** The organization's `sys_queue` rows; `support_desk` shares a declared queue's name. */
  const ROWS = [
    { id: 'q_1', name: 'billing_desk', label: 'Billing Desk' },
    { id: 'q_2', name: 'support_desk', label: 'Support Desk (row)' },
  ];
  /** The `queue` items a package declares, as `GET /api/v1/meta/queue` lists them. */
  const DECLARED = [
    { name: 'support_desk', label: 'Support Desk' },
    { name: 'escalations', label: 'Escalations' },
  ];

  /**
   * One `$filter` node over a row: the object form (`$and`, and a `name` that
   * is a value, `$in` or `$nin`) and the array form `mergeFilterNodes` writes
   * for the recents rail (`['and', …]`, `['name', 'in' | 'nin' | '=', v]`).
   */
  function matches(row: { name: string }, filter: any): boolean {
    if (!filter) return true;
    if (Array.isArray(filter)) {
      const [head, op, value] = filter;
      if (head === 'and') return filter.slice(1).every((f: unknown) => matches(row, f));
      if (head !== 'name') return true;
      if (op === 'in') return value.includes(row.name);
      if (op === 'nin') return !value.includes(row.name);
      return op === '=' ? row.name === value : true;
    }
    if (Array.isArray(filter.$and) && !filter.$and.every((f: Record<string, any>) => matches(row, f))) return false;
    const byName = filter.name;
    if (typeof byName === 'string' && row.name !== byName) return false;
    if (Array.isArray(byName?.$in) && !byName.$in.includes(row.name)) return false;
    if (Array.isArray(byName?.$nin) && byName.$nin.includes(row.name)) return false;
    return true;
  }

  /** `sys_queue` as the data API serves it, honouring `$search` and `$filter`. */
  function queueBackend() {
    return vi.fn(async (objectName: string, params: Record<string, any> = {}) => {
      if (objectName !== 'sys_queue') return { data: [], total: 0 };
      let rows = ROWS;
      const term = typeof params.$search === 'string' ? params.$search.toLowerCase() : '';
      if (term) rows = rows.filter((q) => q.label.toLowerCase().includes(term) || q.name.includes(term));
      rows = rows.filter((q) => matches(q, params.$filter));
      return { data: rows.map((q) => ({ ...q })), total: rows.length };
    });
  }

  async function settle(ms = 0) {
    for (let i = 0; i < 6; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
    }
  }

  afterEach(() => cleanup());

  function mountQueueDialog(records: Array<Record<string, unknown>>, ensureType: (type: string) => Promise<any[]>) {
    const find = queueBackend();
    const changeOwner = vi.fn(async () => ({ object: 'crm_case', id: 'c1', queue: 'x' }));
    const changeOwnerMany = vi.fn(async () => ({
      object: 'crm_case', field: 'owner_id', queue: 'x', updated: records.length, failed: 0, failures: [], notified: 0,
    }));
    const adapter = { getClient: () => ({ data: { changeOwner, changeOwnerMany } }), find } as any;
    const store = { ensureType: vi.fn(ensureType) };
    render(
      <AdapterCtx.Provider value={adapter}>
        <MetadataCtx.Provider value={store as any}>
          <SchemaRendererContext.Provider value={{ dataSource: adapter } as any}>
            <ChangeOwnerDialog
              open
              onOpenChange={vi.fn()}
              objectDef={{ name: 'crm_case', fields: { owner_id: {}, queue: { type: 'text' } } } as any}
              records={records}
            />
          </SchemaRendererContext.Provider>
        </MetadataCtx.Provider>
      </AdapterCtx.Provider>,
    );
    return { find, changeOwner, changeOwnerMany, store };
  }

  const declaredRead = async () => DECLARED.map((q) => ({ ...q }));
  const queueReads = (find: ReturnType<typeof vi.fn>) => find.mock.calls.filter((c) => c[0] === 'sys_queue').map((c) => c[1] ?? {});

  async function showQueueTarget() {
    fireEvent.click(screen.getByTestId('change-owner-kind-queue'));
    await screen.findByTestId('lookup-trigger-change_owner_queue');
    await settle();
  }

  async function openLookup() {
    await act(async () => { fireEvent.click(screen.getByTestId('lookup-trigger-change_owner_queue')); });
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
    await settle();
  }

  it('one record: a declared queue is offered, picked, and the owner write names it', async () => {
    const { changeOwner, store } = mountQueueDialog([{ id: 'c1', owner_id: 'u_amy' }], declaredRead);
    await showQueueTarget();
    expect(store.ensureType).toHaveBeenCalledWith('queue');
    const group = await screen.findByTestId('change-owner-declared-queues');
    expect(within(group).getByText('Escalations (escalations)')).toBeTruthy();
    fireEvent.click(screen.getByTestId('change-owner-declared-queue-escalations'));
    await settle();
    fireEvent.click(screen.getByTestId('change-owner-submit'));
    await waitFor(() => expect(changeOwner).toHaveBeenCalledWith('crm_case', 'c1', { queue: 'escalations' }));
  });

  it('a list: a declared queue picked moves every record to it by name', async () => {
    const { changeOwnerMany } = mountQueueDialog([{ id: 'c1' }, { id: 'c2' }], declaredRead);
    await showQueueTarget();
    fireEvent.click(await screen.findByTestId('change-owner-declared-queue-support_desk'));
    await settle();
    fireEvent.click(screen.getByTestId('change-owner-submit'));
    await screen.findByTestId('change-owner-report');
    expect(changeOwnerMany).toHaveBeenCalledWith('crm_case', ['c1', 'c2'], { queue: 'support_desk' });
  });

  it('a plain sys_queue row is still offered by the lookup, picked, and sent by its name', async () => {
    const { changeOwner } = mountQueueDialog([{ id: 'c1', owner_id: 'u_amy' }], declaredRead);
    await showQueueTarget();
    await screen.findByTestId('change-owner-declared-queues');
    await openLookup();
    fireEvent.click(await screen.findByRole('option', { name: /Billing Desk/ }));
    await settle();
    // The lookup's pick is the target; no declared choice stays ticked beside it.
    expect(screen.getByTestId('change-owner-declared-queue-support_desk').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByTestId('change-owner-submit'));
    await waitFor(() => expect(changeOwner).toHaveBeenCalledWith('crm_case', 'c1', { queue: 'billing_desk' }));
  });

  it('a declared queue and a sys_queue row of the same name are offered once: the declared one wins', async () => {
    const { find } = mountQueueDialog([{ id: 'c1', owner_id: 'u_amy' }], declaredRead);
    await showQueueTarget();
    await screen.findByTestId('change-owner-declared-queues');
    await openLookup();
    // Every read the lookup sends (its list, and the recents rail when it has
    // any) asks the server to leave the declared names out, so the row is not drawn …
    const reads = queueReads(find);
    expect(reads.length).toBeGreaterThan(0);
    const leftOut = /\{"name":\{"\$nin":\["escalations","support_desk"\]\}\}|\["name","nin",\["escalations","support_desk"\]\]/;
    for (const p of reads) expect(JSON.stringify(p.$filter)).toMatch(leftOut);
    expect(screen.queryByRole('option', { name: /Support Desk \(row\)/ })).toBeNull();
    expect(screen.getByRole('option', { name: /Billing Desk/ })).toBeTruthy();
    // … and the declared queue is drawn exactly once.
    expect(screen.getAllByText('Support Desk (support_desk)')).toHaveLength(1);
  });

  it('a failed declared read offers no declared queue, and the sys_queue lookup works unfiltered', async () => {
    const { find, changeOwner } = mountQueueDialog([{ id: 'c1', owner_id: 'u_amy' }], async () => { throw new Error('meta read refused'); });
    await showQueueTarget();
    expect(screen.queryByTestId('change-owner-declared-queues')).toBeNull();
    await openLookup();
    const reads = queueReads(find);
    expect(reads.length).toBeGreaterThan(0);
    for (const p of reads) expect(JSON.stringify(p.$filter ?? {})).not.toContain('$nin');
    fireEvent.click(await screen.findByRole('option', { name: /Support Desk \(row\)/ }));
    await settle();
    fireEvent.click(screen.getByTestId('change-owner-submit'));
    await waitFor(() => expect(changeOwner).toHaveBeenCalledWith('crm_case', 'c1', { queue: 'support_desk' }));
  });

  it('reads no declared queue until the queue target is shown', async () => {
    const { store } = mountQueueDialog([{ id: 'c1', owner_id: 'u_amy' }], declaredRead);
    await settle();
    expect(store.ensureType).not.toHaveBeenCalled();
  });
});

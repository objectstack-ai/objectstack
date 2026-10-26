/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * RecordPreviewCard (objectui#12029) — the four states, the title rule, the
 * shared definition read, and the two isolation properties the module header
 * claims (field-level security, the host's inline-edit session). Since
 * objectui#12557, also the readable state's link, built by the host's
 * record-URL builder, and its absence in every other state.
 *
 * States are read from the card's `data-record-preview` attribute, never from
 * its copy: the unreadable pin compares whole renderings across causes instead
 * of looking for (or forbidding) particular words, because "says nothing about
 * why" is a property of the rendering being the SAME for every cause.
 */

import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  InlineEditProvider,
  MetadataCtx,
  notifyDataChanged,
  RelatedRecordActionsProvider,
  useInlineEdit,
} from '@object-ui/react';
import { PermissionProvider } from '@object-ui/permissions';
import { MetadataProvider } from '../../providers/MetadataProvider';
import { RecordPreviewCard, type RecordPreviewSource } from './RecordPreviewCard';

const OBJECT = 'invoice_12029';

const DEF = {
  name: OBJECT,
  label: 'Invoice',
  // The declared title pointer. The record ALSO carries a `name`, which the
  // type-aware derivation would pick — so a card that skipped the declared
  // rung would title the record with the wrong field.
  nameField: 'subject',
  highlightFields: ['amount', 'note'],
  fields: {
    name: { type: 'text', label: 'Code' },
    subject: { type: 'text', label: 'Subject' },
    amount: { type: 'number', label: 'Amount' },
    note: { type: 'text', label: 'Note' },
    account: { type: 'lookup', reference: 'account', label: 'Account' },
  },
};

const RECORD = {
  id: 'INV-1',
  name: 'INV-0001',
  subject: 'Laptop refresh',
  amount: 4200,
  note: 'Quarterly batch',
};

/** A metadata context whose `getItem` serves `defs` and counts its calls. */
function metadataStub(defs: Record<string, unknown>) {
  const getItem = vi.fn(async (type: string, name: string) =>
    (type === 'object' ? (defs[name] ?? null) : null));
  const value = {
    apps: [], objects: [], dashboards: [], reports: [], pages: [],
    loading: false, error: null,
    refresh: async () => {}, invalidate: () => {}, ensureType: async () => [],
    getItem,
    getItemsByType: () => [],
    getTypeStatus: () => 'ready' as const,
  };
  return { value, getItem };
}

function source(impl: (objectName: string, id: string, params?: unknown) => unknown) {
  const findOne = vi.fn(async (objectName: string, id: string, params?: unknown) => impl(objectName, id, params));
  return { findOne } satisfies RecordPreviewSource;
}

function mount(ui: React.ReactElement, defs: Record<string, unknown> = { [OBJECT]: DEF }) {
  const { value, getItem } = metadataStub(defs);
  const utils = render(<MetadataCtx.Provider value={value as never}>{ui}</MetadataCtx.Provider>);
  return { ...utils, getItem };
}

const stateOf = (container: HTMLElement) =>
  container.querySelector('[data-record-preview]')?.getAttribute('data-record-preview');

async function settle(container: HTMLElement, expected: string) {
  await waitFor(() => expect(stateOf(container)).toBe(expected));
}

describe('RecordPreviewCard — absent (objectui#12029)', () => {
  it.each([
    ['no record id', OBJECT, null],
    ['a blank record id', OBJECT, '  '],
    ['no object name', '', 'INV-1'],
    ['neither half', null, null],
  ])('renders the empty-value placeholder and reads nothing for %s', async (_case, objectName, recordId) => {
    const ds = source(() => RECORD);
    const { container, getItem } = mount(
      <RecordPreviewCard objectName={objectName} recordId={recordId} dataSource={ds} />,
    );
    expect(stateOf(container)).toBe('absent');
    expect(container.querySelector('[data-slot="empty-value"]')).not.toBeNull();
    await act(async () => {});
    expect(getItem).not.toHaveBeenCalled();
    expect(ds.findOne).not.toHaveBeenCalled();
  });
});

describe('RecordPreviewCard — loading and readable (objectui#12029)', () => {
  it('stays loading until the record read answers, then draws the record', async () => {
    let answer: (value: unknown) => void = () => {};
    const ds = source(() => new Promise((resolve) => { answer = resolve; }));
    const { container } = mount(<RecordPreviewCard objectName={OBJECT} recordId="INV-1" dataSource={ds} />);

    expect(stateOf(container)).toBe('loading');
    await waitFor(() => expect(ds.findOne).toHaveBeenCalledTimes(1));
    expect(stateOf(container)).toBe('loading');
    expect(container.querySelector('[role="status"][aria-busy="true"]')).not.toBeNull();

    await act(async () => { answer({ ...RECORD }); });
    await settle(container, 'readable');
  });

  it('titles the record by the declared nameField, heads it with the object label, and draws the declared highlight fields', async () => {
    const ds = source(() => ({ ...RECORD }));
    const { container } = mount(<RecordPreviewCard objectName={OBJECT} recordId="INV-1" dataSource={ds} />);
    await settle(container, 'readable');

    expect(screen.getByTitle('Laptop refresh')).toHaveTextContent('Laptop refresh');
    expect(screen.queryByText('INV-0001')).toBeNull();
    expect(screen.getByText('Invoice')).toBeInTheDocument();
    expect(screen.getByText('Note')).toBeInTheDocument();
    expect(screen.getByText('Quarterly batch')).toBeInTheDocument();

    // One read, the record page's request shape: no reference field is shown,
    // so nothing is expanded and no params are sent.
    expect(ds.findOne).toHaveBeenCalledTimes(1);
    expect(ds.findOne).toHaveBeenCalledWith(OBJECT, 'INV-1');
  });

  it('expands a reference field only when the card shows it', async () => {
    const withAccount = { ...DEF, highlightFields: ['account', 'note'] };
    const ds = source(() => ({ ...RECORD, account: { id: 'A1', name: 'Northwind' } }));
    const { container } = mount(
      <RecordPreviewCard objectName={OBJECT} recordId="INV-1" dataSource={ds} />,
      { [OBJECT]: withAccount },
    );
    await settle(container, 'readable');
    expect(ds.findOne).toHaveBeenCalledWith(OBJECT, 'INV-1', { $expand: ['account'] });
  });

  it('re-reads in place when the record is invalidated, without falling back to loading', async () => {
    let note = 'Quarterly batch';
    const ds = source(() => ({ ...RECORD, note }));
    const { container } = mount(<RecordPreviewCard objectName={OBJECT} recordId="INV-1" dataSource={ds} />);
    await settle(container, 'readable');

    note = 'Approved batch';
    act(() => { notifyDataChanged({ objectName: OBJECT, recordId: 'INV-1' }); });
    expect(stateOf(container)).toBe('readable');
    await waitFor(() => expect(screen.getByText('Approved batch')).toBeInTheDocument());
    expect(ds.findOne).toHaveBeenCalledTimes(2);
  });
});

describe('RecordPreviewCard — unreadable says nothing about why (objectui#12029)', () => {
  const causes: Array<[string, (objectName: string, id: string) => unknown]> = [
    // The adapter answers a 404 by resolving null — the platform's answer for a
    // deleted record AND for one outside this viewer's row set.
    ['the read resolved with no record', () => null],
    ['the read was refused', () => {
      throw Object.assign(new Error('Forbidden'), { httpStatus: 403, code: 'PERMISSION_DENIED' });
    }],
    ['the read failed', () => {
      throw Object.assign(new Error('HTTP 500 Internal Server Error'), { httpStatus: 500 });
    }],
  ];

  it('renders one identical card for every cause, and none of the record', async () => {
    const renderings: string[] = [];
    for (const [, impl] of causes) {
      const ds = source(impl);
      const { container, unmount } = mount(<RecordPreviewCard objectName={OBJECT} recordId="INV-1" dataSource={ds} />);
      await settle(container, 'unreadable');
      expect(ds.findOne).toHaveBeenCalledTimes(1);
      renderings.push(container.innerHTML);
      unmount();
    }

    // A data source that throws synchronously instead of rejecting.
    const throwing: RecordPreviewSource = {
      findOne: vi.fn(() => { throw new Error('boom'); }),
    };
    const sync = mount(<RecordPreviewCard objectName={OBJECT} recordId="INV-1" dataSource={throwing} />);
    await settle(sync.container, 'unreadable');
    renderings.push(sync.container.innerHTML);
    sync.unmount();

    // The object's definition is unavailable: no record read is made at all.
    const ds = source(() => RECORD);
    const noDef = mount(<RecordPreviewCard objectName={OBJECT} recordId="INV-1" dataSource={ds} />, {});
    await settle(noDef.container, 'unreadable');
    expect(noDef.getItem).toHaveBeenCalledWith('object', OBJECT);
    expect(ds.findOne).not.toHaveBeenCalled();
    renderings.push(noDef.container.innerHTML);

    expect(renderings).toHaveLength(5);
    expect(new Set(renderings).size).toBe(1);
    expect(renderings[0]).not.toContain('Laptop refresh');
    expect(renderings[0]).not.toContain('Invoice');
  });
});

describe('RecordPreviewCard — one definition read for N cards (objectui#12029)', () => {
  /** The real provider over an adapter that counts by-name definition reads. */
  function makeAdapter(defs: Record<string, unknown>, itemCalls: string[]) {
    return {
      clearCache: vi.fn(),
      invalidateCache: vi.fn(),
      // objectui#13044 — the provider's by-name OBJECT read goes through the
      // adapter's `getObjectSchema`. This double answers it from the same
      // by-name door, unwrapped the way the adapter unwraps it.
      getObjectSchema(this: { getClient(): any }, name: string) {
        return this.getClient()
          .meta.getItem('object', name)
          .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
      },
      getClient: () => ({
        meta: {
          getItems: (type: string) => Promise.resolve({ type, items: [] }),
          getItem: (type: string, name: string) => {
            itemCalls.push(`${type}/${name}`);
            const doc = type === 'object' ? defs[name] : undefined;
            return Promise.resolve({ item: doc ? structuredClone(doc) : null });
          },
        },
      }),
    } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
  }

  it('shares the definition read across cards of one object; each card reads its own record', async () => {
    const OTHER = 'ticket_12029';
    const itemCalls: string[] = [];
    const adapter = makeAdapter({
      [OBJECT]: DEF,
      [OTHER]: { name: OTHER, label: 'Ticket', fields: { title: { type: 'text', label: 'Title' } } },
    }, itemCalls);
    const ds = source((objectName, id) =>
      (objectName === OBJECT ? { ...RECORD, id, subject: `Invoice ${id}` } : { id, title: `Ticket ${id}` }));

    render(
      <MetadataProvider adapter={adapter}>
        <RecordPreviewCard objectName={OBJECT} recordId="INV-1" dataSource={ds} />
        <RecordPreviewCard objectName={OBJECT} recordId="INV-2" dataSource={ds} />
        <RecordPreviewCard objectName={OBJECT} recordId="INV-3" dataSource={ds} />
        <RecordPreviewCard objectName={OTHER} recordId="T-1" dataSource={ds} />
      </MetadataProvider>,
    );

    await waitFor(() => expect(document.querySelectorAll('[data-record-preview="readable"]')).toHaveLength(4));
    expect(screen.getByText('Invoice INV-2')).toBeInTheDocument();
    expect(screen.getByText('Ticket T-1')).toBeInTheDocument();

    expect(itemCalls.filter((c) => c === `object/${OBJECT}`)).toHaveLength(1);
    expect(itemCalls.filter((c) => c === `object/${OTHER}`)).toHaveLength(1);
    expect(ds.findOne).toHaveBeenCalledTimes(4);
  });
});

describe('RecordPreviewCard — isolation (objectui#12029)', () => {
  const PERMISSIONS = [
    {
      object: OBJECT,
      roles: {
        viewer: {
          actions: ['read'],
          fieldPermissions: [
            { field: 'subject', read: false },
            { field: 'note', read: false },
            { field: 'account', read: false },
          ],
        },
      },
    },
  ];
  const USER_ROLES = ['viewer'];

  it('does not draw a field the loaded policy denies, and the title falls through the ladder', async () => {
    const ds = source(() => ({ ...RECORD }));
    const { container } = mount(
      <PermissionProvider roles={[]} userRoles={USER_ROLES} permissions={PERMISSIONS as never}>
        <RecordPreviewCard objectName={OBJECT} recordId="INV-1" dataSource={ds} />
      </PermissionProvider>,
    );
    await settle(container, 'readable');

    expect(screen.getByTitle('INV-0001')).toBeInTheDocument();
    expect(screen.queryByText('Laptop refresh')).toBeNull();
    expect(screen.queryByText('Quarterly batch')).toBeNull();
  });

  it('does not expand a reference field the loaded policy denies', async () => {
    const withAccount = { ...DEF, highlightFields: ['account', 'amount'] };
    const ds = source(() => ({ ...RECORD }));
    const { container } = mount(
      <PermissionProvider roles={[]} userRoles={USER_ROLES} permissions={PERMISSIONS as never}>
        <RecordPreviewCard objectName={OBJECT} recordId="INV-1" dataSource={ds} />
      </PermissionProvider>,
      { [OBJECT]: withAccount },
    );
    await settle(container, 'readable');
    expect(ds.findOne).toHaveBeenLastCalledWith(OBJECT, 'INV-1');
  });

  it('keeps a host inline-edit session out of the card', async () => {
    /** Puts the HOST record's session into edit mode with a draft value for `note`. */
    function HostEditing() {
      const inline = useInlineEdit();
      const started = React.useRef(false);
      React.useEffect(() => {
        if (started.current || !inline) return;
        started.current = true;
        inline.enter();
        inline.setField('note', 'Host draft value');
      }, [inline]);
      return inline?.editing ? <span data-testid="host-editing" /> : null;
    }
    const ds = source(() => ({ ...RECORD }));
    const { container } = mount(
      <InlineEditProvider canEdit>
        <HostEditing />
        <RecordPreviewCard objectName={OBJECT} recordId="INV-1" dataSource={ds} />
      </InlineEditProvider>,
    );
    await settle(container, 'readable');
    // The host session really is editing, with a draft for a field the card shows.
    expect(screen.getByTestId('host-editing')).toBeInTheDocument();

    expect(screen.getByText('Quarterly batch')).toBeInTheDocument();
    expect(screen.queryByText('Host draft value')).toBeNull();
    expect(container.querySelector('input, textarea')).toBeNull();
  });
});

describe('RecordPreviewCard — the readable state links to the record (objectui#12557)', () => {
  const HREF = '/apps/probe_app/invoice_12029/record/INV-1';

  /**
   * A host's record-URL builder, as `RelatedRecordActionsBridge` publishes it:
   * an href for the objects it can route to, `null` for any other.
   */
  function host(routable: readonly string[] = [OBJECT], withOpen = true) {
    const recordHref = vi.fn((objectName: string, recordId: string | number) =>
      (routable.includes(objectName) ? `/apps/probe_app/${objectName}/record/${encodeURIComponent(String(recordId))}` : null));
    const openRecord = vi.fn();
    const value = { resolve: () => ({}), recordHref, ...(withOpen ? { openRecord } : {}) };
    return { value, recordHref, openRecord };
  }

  function mountUnder(value: React.ComponentProps<typeof RelatedRecordActionsProvider>['value'], ui: React.ReactElement, defs?: Record<string, unknown>) {
    return mount(<RelatedRecordActionsProvider value={value}>{ui}</RelatedRecordActionsProvider>, defs);
  }

  const links = (container: HTMLElement) => Array.from(container.querySelectorAll('a[href]'));

  it('links the title, and only the title, to the href the host answers for the record', async () => {
    const h = host();
    const ds = source(() => ({ ...RECORD }));
    const { container } = mountUnder(h.value, <RecordPreviewCard objectName={OBJECT} recordId="INV-1" dataSource={ds} />);
    await settle(container, 'readable');

    expect(links(container)).toHaveLength(1);
    const link = screen.getByRole('link', { name: 'Laptop refresh' });
    expect(link.getAttribute('href')).toBe(HREF);
    expect(h.recordHref).toHaveBeenCalledWith(OBJECT, 'INV-1');
    // The title itself is the link, and nothing else in the card is inside it.
    expect(link.textContent).toBe('Laptop refresh');
    expect(link.closest('[data-record-preview]')?.getAttribute('data-record-preview')).toBe('readable');
  });

  it('a plain left click navigates in-app through the host, and does not reach the row the card sits in', async () => {
    const h = host();
    const rowClick = vi.fn();
    const ds = source(() => ({ ...RECORD }));
    const { container } = mountUnder(
      h.value,
      <div onClick={rowClick}>
        <RecordPreviewCard objectName={OBJECT} recordId="INV-1" dataSource={ds} />
      </div>,
    );
    await settle(container, 'readable');

    const notPrevented = fireEvent.click(screen.getByRole('link', { name: 'Laptop refresh' }), { button: 0 });
    expect(notPrevented).toBe(false);
    expect(h.openRecord).toHaveBeenCalledTimes(1);
    expect(h.openRecord).toHaveBeenCalledWith(OBJECT, 'INV-1');
    expect(rowClick).not.toHaveBeenCalled();
  });

  it.each([
    ['ctrl', { ctrlKey: true }],
    ['meta', { metaKey: true }],
    ['shift', { shiftKey: true }],
    ['alt', { altKey: true }],
    ['middle button', { button: 1 }],
  ])('a %s click is left to the browser and its href', async (_case, init) => {
    const h = host();
    const rowClick = vi.fn();
    const ds = source(() => ({ ...RECORD }));
    const { container } = mountUnder(
      h.value,
      <div onClick={rowClick}>
        <RecordPreviewCard objectName={OBJECT} recordId="INV-1" dataSource={ds} />
      </div>,
    );
    await settle(container, 'readable');

    const notPrevented = fireEvent.click(screen.getByRole('link', { name: 'Laptop refresh' }), init);
    expect(notPrevented).toBe(true);
    expect(h.openRecord).not.toHaveBeenCalled();
    expect(rowClick).not.toHaveBeenCalled();
  });

  it('with a host that has no in-app navigator, a plain click is the anchor\'s own', async () => {
    const h = host([OBJECT], false);
    const ds = source(() => ({ ...RECORD }));
    const { container } = mountUnder(h.value, <RecordPreviewCard objectName={OBJECT} recordId="INV-1" dataSource={ds} />);
    await settle(container, 'readable');

    expect(fireEvent.click(screen.getByRole('link', { name: 'Laptop refresh' }), { button: 0 })).toBe(true);
  });

  it("Enter on the link does not reach the row's key handler", async () => {
    const h = host();
    const rowKeyDown = vi.fn((e: React.KeyboardEvent) => e.preventDefault());
    const ds = source(() => ({ ...RECORD }));
    const { container } = mountUnder(
      h.value,
      <div onKeyDown={rowKeyDown}>
        <RecordPreviewCard objectName={OBJECT} recordId="INV-1" dataSource={ds} />
      </div>,
    );
    await settle(container, 'readable');

    expect(fireEvent.keyDown(screen.getByRole('link', { name: 'Laptop refresh' }), { key: 'Enter' })).toBe(true);
    expect(rowKeyDown).not.toHaveBeenCalled();
  });

  it('never nests one anchor in another: a lookup in the highlight strip is a link of its own', async () => {
    const withAccount = { ...DEF, highlightFields: ['account', 'note'] };
    const h = host([OBJECT, 'account']);
    const ds = source(() => ({ ...RECORD, account: { id: 'A1', name: 'Northwind' } }));
    const { container } = mountUnder(
      h.value,
      <RecordPreviewCard objectName={OBJECT} recordId="INV-1" dataSource={ds} />,
      { [OBJECT]: withAccount },
    );
    await settle(container, 'readable');

    const anchors = links(container);
    expect(anchors.map((a) => a.getAttribute('href'))).toEqual([HREF, '/apps/probe_app/account/record/A1']);
    expect(container.querySelectorAll('a a')).toHaveLength(0);
  });

  it('CONTROL: with no host the title is plain text, and the card holds no link', async () => {
    const ds = source(() => ({ ...RECORD }));
    const { container } = mount(<RecordPreviewCard objectName={OBJECT} recordId="INV-1" dataSource={ds} />);
    await settle(container, 'readable');

    expect(screen.getByTitle('Laptop refresh')).toHaveTextContent('Laptop refresh');
    expect(links(container)).toHaveLength(0);
  });

  it('CONTROL: a host that cannot route to the object answers no href, and the card holds no link', async () => {
    const h = host(['some_other_object']);
    const ds = source(() => ({ ...RECORD }));
    const { container } = mountUnder(h.value, <RecordPreviewCard objectName={OBJECT} recordId="INV-1" dataSource={ds} />);
    await settle(container, 'readable');

    expect(h.recordHref).toHaveBeenCalledWith(OBJECT, 'INV-1');
    expect(screen.getByTitle('Laptop refresh')).toHaveTextContent('Laptop refresh');
    expect(links(container)).toHaveLength(0);
  });

  it.each([
    ['the read resolved with no record', () => null],
    ['the read was refused', () => {
      throw Object.assign(new Error('Forbidden'), { httpStatus: 403, code: 'PERMISSION_DENIED' });
    }],
  ])('CONTROL: unreadable (%s) draws no link, and never asks the host for one', async (_case, impl) => {
    const h = host();
    const ds = source(impl);
    const { container } = mountUnder(h.value, <RecordPreviewCard objectName={OBJECT} recordId="INV-1" dataSource={ds} />);
    await settle(container, 'unreadable');

    expect(links(container)).toHaveLength(0);
    expect(h.recordHref).not.toHaveBeenCalled();
  });

  it('CONTROL: absent and loading draw no link, and never ask the host for one', async () => {
    const h = host();
    const absent = mountUnder(h.value, <RecordPreviewCard objectName={OBJECT} recordId={null} dataSource={source(() => RECORD)} />);
    expect(stateOf(absent.container)).toBe('absent');
    expect(links(absent.container)).toHaveLength(0);
    absent.unmount();

    const pending = source(() => new Promise(() => {}));
    const loading = mountUnder(h.value, <RecordPreviewCard objectName={OBJECT} recordId="INV-1" dataSource={pending} />);
    await waitFor(() => expect(pending.findOne).toHaveBeenCalledTimes(1));
    expect(stateOf(loading.container)).toBe('loading');
    expect(links(loading.container)).toHaveLength(0);
    expect(h.recordHref).not.toHaveBeenCalled();
  });
});

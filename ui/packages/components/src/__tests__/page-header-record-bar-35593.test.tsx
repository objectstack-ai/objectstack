/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35593 — the record's header is ONE row: where the host offers
 * its bar (`RecordHeaderBarContext`), `page:header` draws the record's name,
 * its stage tag and the state's tags into the bar's title slot and its ONE
 * button group into the bar's action slot, and draws no row of its own. In
 * the bar the record's group is Edit, up to three inline actions (the primary
 * first) and the `⋯` — objectstack#35853 gave the bar the default budget of 3
 * back (#35593 had set it to 1), folding by width where the bar is narrow. A state (`RecordHeaderStateContext`) may hand a `group` that takes the
 * record's row, getting the record's actions as `⋯` items to fold in.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
import '../renderers';
// `page` reaches the react runtime through a dynamic import: pay that load at
// collection, not inside a clocked case.
import '@object-ui/react-runtime';
import {
  RecordHeaderBarContext,
  RecordHeaderStateContext,
  type RecordHeaderGroupParts,
  type RecordHeaderState,
} from '../renderers/layout/record-header-bar-context';

afterEach(() => cleanup());

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <Component schema={schema} />;
}

const LEAD = { id: 'lead-1', name: 'Mira Costa', status: 'contacted' };
const LEAD_SCHEMA = {
  name: 'crm_lead',
  label: 'Lead',
  fields: {
    name: { type: 'text', label: 'Name' },
    status: {
      type: 'select',
      label: 'Status',
      options: [
        { value: 'new', label: 'New' },
        { value: 'contacted', label: 'Contacted' },
      ],
    },
  },
};

const HOST_ACTIONS = [
  { name: 'sys_edit', label: 'Edit', icon: 'pencil', order: 100, onClick: vi.fn() },
  { name: 'sys_delete', label: 'Delete', order: 120, variant: 'destructive', component: 'action:menu', onClick: vi.fn() },
];

const act = (name: string, label: string, extra: Record<string, unknown> = {}) => ({
  name,
  label,
  type: 'url',
  target: `https://example.com/${name}`,
  locations: ['record_header'],
  ...extra,
});

const ACTIONS = [act('convert', 'Convert', { variant: 'primary' }), act('log_call', 'Log call'), act('send_email', 'Send email')];

/** A host bar: two slots and a claim, as the record page's top bar offers. */
function BarHost({
  claim,
  preview,
  children,
}: {
  claim: (claimed: boolean) => void;
  preview?: boolean;
  children: React.ReactNode;
}) {
  const [titleSlot, setTitleSlot] = React.useState<HTMLElement | null>(null);
  const [actionSlot, setActionSlot] = React.useState<HTMLElement | null>(null);
  const bar = React.useMemo(
    () => ({ titleSlot, actionSlot, claim, ...(preview ? { preview } : {}) }),
    [titleSlot, actionSlot, claim, preview],
  );
  return (
    <>
      <div data-testid="bar" data-record-top-bar="">
        <span ref={setTitleSlot} data-testid="title-slot" />
        <span ref={setActionSlot} data-testid="action-slot" />
      </div>
      <RecordHeaderBarContext.Provider value={bar}>{children}</RecordHeaderBarContext.Provider>
    </>
  );
}

function renderHeader({
  schema = { type: 'page:header', actions: ACTIONS },
  bar,
  preview,
  state,
  hostActions = HOST_ACTIONS,
}: {
  schema?: any;
  bar?: (claimed: boolean) => void;
  preview?: boolean;
  state?: RecordHeaderState;
  hostActions?: unknown[];
} = {}) {
  const header = (
    <ActionProvider>
      <RecordContextProvider
        objectName="crm_lead"
        recordId={LEAD.id}
        data={LEAD}
        objectSchema={LEAD_SCHEMA}
        headerSystemActions={hostActions}
      >
        <RecordHeaderStateContext.Provider value={state ?? null}>
          <PageHeader schema={schema} />
        </RecordHeaderStateContext.Provider>
      </RecordContextProvider>
    </ActionProvider>
  );
  return render(bar ? <BarHost claim={bar} preview={preview}>{header}</BarHost> : header);
}

const inlineButtons = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('button')).map((b) => b.textContent?.trim() || b.getAttribute('aria-label'));

describe('page:header in the host bar (objectstack#35593)', () => {
  it('draws the name and stage tag into the title slot, the group into the action slot, and no row of its own', async () => {
    const claim = vi.fn();
    const { unmount } = renderHeader({ bar: claim });

    const titleSlot = screen.getByTestId('title-slot');
    await waitFor(() => expect(titleSlot.textContent).toContain('Mira Costa'));
    expect(titleSlot.querySelector('[data-record-stage-tag="status"]')?.textContent).toBe('Contacted');
    // The bar's navigation row names the object or the list; the chip does not repeat it.
    expect(titleSlot.textContent).not.toContain('Lead');
    expect(document.querySelector('header')).toBeNull();
    expect(claim).toHaveBeenCalledWith(true);

    unmount();
    expect(claim).toHaveBeenLastCalledWith(false);
  });

  it('in the bar the record draws Edit, up to three inline actions (the primary first) and the ⋯', async () => {
    renderHeader({ bar: vi.fn() });
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(inlineButtons(actionSlot)).toContain('Send email'));

    const labels = inlineButtons(actionSlot);
    expect(labels).toContain('Edit');
    expect(labels.indexOf('Convert')).toBe(0);
    expect(labels).toContain('Log call');
  });

  it('an authored maxVisible still sets the budget in the bar', async () => {
    renderHeader({ bar: vi.fn(), schema: { type: 'page:header', actions: ACTIONS, maxVisible: 1 } });
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(inlineButtons(actionSlot)).toContain('Convert'));
    expect(inlineButtons(actionSlot)).not.toContain('Log call');
    expect(inlineButtons(actionSlot)).not.toContain('Send email');
  });

  it('recordChrome: false keeps its bare header and never claims the bar', () => {
    const claim = vi.fn();
    renderHeader({ bar: claim, schema: { type: 'page:header', actions: ACTIONS, recordChrome: false } });
    expect(claim).not.toHaveBeenCalled();
    expect(screen.getByTestId('title-slot').childElementCount).toBe(0);
  });

  it('draws the state\'s tags after the record\'s name', async () => {
    renderHeader({ bar: vi.fn(), state: { tags: <span data-testid="state-tag">待你审批</span> } });
    const titleSlot = screen.getByTestId('title-slot');
    await waitFor(() => expect(titleSlot.querySelector('[data-testid="state-tag"]')).toBeTruthy());
  });
});

// objectstack#35415 — the host's name for the record (`RecordHeaderState.title`)
// is the heading in both faces, its node drawn inside the H1; absent or empty,
// the header's own title stands.
describe('the record state\'s title (objectstack#35415)', () => {
  const HOST_TITLE = { text: 'Acceptance T-002', node: <a href="/subject" data-testid="host-title-node">Acceptance T-002</a> };

  it('in the host bar: the H1 draws the host\'s node in place of the record\'s own name', async () => {
    renderHeader({ bar: vi.fn(), state: { title: HOST_TITLE } });
    const titleSlot = screen.getByTestId('title-slot');
    await waitFor(() => expect(titleSlot.querySelector('h1')?.textContent).toBe('Acceptance T-002'));
    expect(titleSlot.querySelector('h1 [data-testid="host-title-node"]')?.getAttribute('href')).toBe('/subject');
    expect(titleSlot.textContent).not.toContain('Mira Costa');
  });

  it('without a host bar: the header row\'s H1 is the host\'s name too', async () => {
    renderHeader({ state: { title: HOST_TITLE } });
    await waitFor(() => expect(document.querySelector('header h1')?.textContent).toBe('Acceptance T-002'));
    expect(document.querySelector('header h1 [data-testid="host-title-node"]')).toBeTruthy();
  });

  it('a host title with no node draws its text', async () => {
    renderHeader({ state: { title: { text: 'Acceptance T-002' } } });
    await waitFor(() => expect(document.querySelector('header h1')?.textContent).toBe('Acceptance T-002'));
  });

  it('CONTROL — an empty host title leaves the record\'s own name', async () => {
    renderHeader({ state: { title: { text: '  ', node: <span>ignored</span> } } });
    await waitFor(() => expect(document.querySelector('header h1')?.textContent).toBe('Mira Costa'));
  });
});

describe('the record state\'s ONE group (objectstack#35593)', () => {
  it('hands the group the record\'s row and the record\'s actions as ⋯ items, and draws what it returns', async () => {
    const seen: RecordHeaderGroupParts[] = [];
    const group = (parts: RecordHeaderGroupParts) => {
      seen.push(parts);
      return <button type="button" data-testid="state-lead">通过</button>;
    };
    renderHeader({ bar: vi.fn(), state: { group } });
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(actionSlot.querySelector('[data-testid="state-lead"]')).toBeTruthy());

    const last = seen[seen.length - 1];
    expect(last.face).toBe('row');
    expect(last.recordRow).toBeTruthy();
    expect(last.recordMenuItems).toBeTruthy();
    // The group took the row: the record's own inline buttons are not drawn.
    expect(inlineButtons(actionSlot)).not.toContain('Convert');
  });

  it('a group that returns the record\'s row draws the record\'s row unchanged', async () => {
    renderHeader({ bar: vi.fn(), state: { group: (parts) => parts.recordRow } });
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(inlineButtons(actionSlot)).toContain('Convert'));
  });

  it('without a host bar the state\'s tags sit under the record\'s name', async () => {
    renderHeader({ state: { tags: <span data-testid="state-tag">审批中</span> } });
    await waitFor(() => expect(document.querySelector('[data-record-header-tags] [data-testid="state-tag"]')).toBeTruthy());
  });
});

/**
 * objectstack#35853 — in the host bar the budget is 3 and folds by width: while
 * the row's buttons wrap past one line, the page's own actions fold into the
 * `⋯` one at a time, down to the primary; the host's Edit never folds. jsdom
 * lays nothing out, so the row's line is stubbed: a child at index 3 or later
 * sits on a second line.
 */
describe('page:header in the host bar folds by width (objectstack#35853)', () => {
  afterEach(() => vi.restoreAllMocks());

  const wrapFromIndex = (first: number) =>
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      const row = this.parentElement;
      if (!row || row.getAttribute('role') !== 'toolbar') return 0;
      return Array.from(row.children).indexOf(this) >= first ? 40 : 0;
    });

  it('a row that wraps folds the page\'s actions down to the primary, and keeps Edit', async () => {
    wrapFromIndex(3);
    renderHeader({ bar: vi.fn() });
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(inlineButtons(actionSlot)).toContain('Convert'));
    await waitFor(() => expect(inlineButtons(actionSlot)).not.toContain('Log call'));
    const labels = inlineButtons(actionSlot);
    expect(labels).toContain('Edit');
    expect(labels).not.toContain('Send email');
  });

  it('CONTROL: a row on one line keeps all three', async () => {
    wrapFromIndex(99);
    renderHeader({ bar: vi.fn() });
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(inlineButtons(actionSlot)).toContain('Send email'));
    expect(inlineButtons(actionSlot)).toContain('Log call');
  });

  it('CONTROL: outside the bar the row never folds by width', async () => {
    wrapFromIndex(1);
    renderHeader();
    await waitFor(() => expect(screen.getAllByRole('button').map((b) => b.textContent?.trim())).toContain('Send email'));
  });
});

/**
 * objectstack#35997 — the width cap belongs to the record and the action set
 * it was measured on. The host steps between records (previous / next, the
 * drawer) without remounting the row, so a cap lowered on a record with many
 * actions must not outlive it: the next record draws the full budget and the
 * next layout measures again. The row's line is stubbed as above, with the
 * wrap point moved between the two records.
 */
describe('page:header in the host bar re-measures the width fold on another record (objectstack#35997)', () => {
  afterEach(() => vi.restoreAllMocks());

  const onlyContacted = { visible: 'record.status == "contacted"' };
  const SWITCH_ACTIONS = [
    act('convert', 'Convert', { variant: 'primary' }),
    act('log_call', 'Log call'),
    act('send_email', 'Send email', onlyContacted),
    act('schedule', 'Schedule', onlyContacted),
  ];
  const OTHER = { id: 'lead-2', name: 'Ada Park', status: 'new' };

  function stubWrap() {
    const line = { wrapAt: 0 };
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      const row = this.parentElement;
      if (!row || row.getAttribute('role') !== 'toolbar') return 0;
      return Array.from(row.children).indexOf(this) >= line.wrapAt ? 40 : 0;
    });
    return line;
  }

  const tree = (record: typeof LEAD) => (
    <BarHost claim={vi.fn()}>
      <ActionProvider>
        <RecordContextProvider
          objectName="crm_lead"
          recordId={record.id}
          data={record}
          objectSchema={LEAD_SCHEMA}
          headerSystemActions={HOST_ACTIONS}
        >
          <RecordHeaderStateContext.Provider value={null}>
            <PageHeader schema={{ type: 'page:header', actions: SWITCH_ACTIONS }} />
          </RecordHeaderStateContext.Provider>
        </RecordContextProvider>
      </ActionProvider>
    </BarHost>
  );

  it('a record with fewer actions that fit draws min(maxVisible, count) again', async () => {
    const line = stubWrap();
    line.wrapAt = 3;
    const { rerender } = render(tree(LEAD));
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(inlineButtons(actionSlot)).toContain('Convert'));
    await waitFor(() => expect(inlineButtons(actionSlot)).not.toContain('Log call'));

    line.wrapAt = 99;
    rerender(tree(OTHER));
    await waitFor(() => expect(inlineButtons(actionSlot)).toContain('Log call'));
    const labels = inlineButtons(actionSlot);
    expect(labels).toContain('Convert');
    expect(labels).toContain('Edit');
    expect(labels).not.toContain('Send email');
  });

  it('CONTROL: a record whose row still wraps after the switch folds again', async () => {
    const line = stubWrap();
    line.wrapAt = 3;
    const { rerender } = render(tree(LEAD));
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(inlineButtons(actionSlot)).not.toContain('Log call'));

    line.wrapAt = 2;
    rerender(tree(OTHER));
    await waitFor(() => expect(inlineButtons(actionSlot)).toContain('Convert'));
    await waitFor(() => expect(inlineButtons(actionSlot)).not.toContain('Log call'));
    expect(inlineButtons(actionSlot)).toContain('Edit');
  });
});

/** The open `⋯` menu's entries, in order. */
async function moreEntries(root: HTMLElement): Promise<string[]> {
  const trigger = Array.from(root.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'More actions');
  expect(trigger, 'the ⋯ trigger').toBeTruthy();
  fireEvent.pointerDown(trigger!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
  return Array.from(screen.getByRole('menu').querySelectorAll('[role="menuitem"]')).map((el) => (el.textContent ?? '').trim());
}

/**
 * objectstack#36201 / objectstack#36149 — a side preview's bar
 * (`RecordHeaderBar.preview`): the record's name first. The row draws ONE
 * labelled action, the primary, however wide the preview is; the rest — the
 * host's Edit too — go into the `⋯` in their order; no copy-id icon after the
 * name, whose full text is its tooltip; and that one action folds as well
 * while the name is cut below sixteen characters' width.
 */
describe('page:header in a side preview\'s bar (objectstack#36201, objectstack#36149)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('draws one labelled action, the primary, and Edit and the rest in the ⋯ in their order', async () => {
    renderHeader({ bar: vi.fn(), preview: true });
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(inlineButtons(actionSlot)).toContain('Convert'));
    expect(inlineButtons(actionSlot)).toEqual(['Convert', 'More actions']);
    expect(await moreEntries(actionSlot)).toEqual(['Log call', 'Send email', 'Edit', 'Delete']);
  });

  it('an authored maxVisible does not bring more buttons back', async () => {
    renderHeader({ bar: vi.fn(), preview: true, schema: { type: 'page:header', actions: ACTIONS, maxVisible: 3 } });
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(inlineButtons(actionSlot)).toContain('Convert'));
    expect(inlineButtons(actionSlot)).toEqual(['Convert', 'More actions']);
  });

  it('a record with no action of its own draws no labelled button: Edit is in the ⋯', async () => {
    renderHeader({ bar: vi.fn(), preview: true, schema: { type: 'page:header' } });
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(inlineButtons(actionSlot)).toEqual(['More actions']));
    expect(await moreEntries(actionSlot)).toEqual(['Edit', 'Delete']);
  });

  it('the host\'s edit state keeps its Cancel and Save in the row; the page\'s actions fold', async () => {
    const editState = [
      { name: 'sys_record_edit_cancel', label: 'Cancel', order: 99, variant: 'outline', onClick: vi.fn() },
      { name: 'sys_record_edit_save', label: 'Save', order: 100, variant: 'primary', onClick: vi.fn() },
    ];
    renderHeader({ bar: vi.fn(), preview: true, hostActions: editState });
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(inlineButtons(actionSlot)).toContain('Save'));
    expect(inlineButtons(actionSlot)).toEqual(['Cancel', 'Save', 'More actions']);
  });

  it('draws no copy-id icon after the name, and the name\'s full text is its tooltip', async () => {
    renderHeader({ bar: vi.fn(), preview: true });
    const titleSlot = screen.getByTestId('title-slot');
    await waitFor(() => expect(titleSlot.querySelector('h1')?.textContent).toBe('Mira Costa'));
    expect(copyIdButton(titleSlot)).toBeUndefined();
    expect(titleSlot.querySelector('h1 [data-record-header-name]')?.getAttribute('title')).toBe('Mira Costa');
  });

  it('CONTROL — a page\'s bar keeps the copy-id icon and draws no tooltip node', async () => {
    renderHeader({ bar: vi.fn() });
    const titleSlot = screen.getByTestId('title-slot');
    await waitFor(() => expect(titleSlot.querySelector('h1')?.textContent).toBe('Mira Costa'));
    expect(copyIdButton(titleSlot)).toBeTruthy();
    expect(titleSlot.querySelector('[data-record-header-name]')).toBeNull();
  });

  /** The chip's copy-id icon (its label is the bundle key with no `I18nProvider`). */
  const copyIdButton = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('button')).find((b) => /copy/i.test(b.getAttribute('aria-label') ?? ''));

  /** jsdom lays nothing out: the name's drawn and full widths are stubbed. */
  function stubName(shown: number, full: number) {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.tagName === 'H1' ? shown : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.tagName === 'H1' ? full : 0;
    });
  }

  it('a name cut below sixteen characters\' width folds the one action too', async () => {
    // 16 px text: sixteen characters are 256 px.
    stubName(120, 300);
    renderHeader({ bar: vi.fn(), preview: true });
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(inlineButtons(actionSlot)).toEqual(['More actions']));
    expect(await moreEntries(actionSlot)).toEqual(['Convert', 'Log call', 'Send email', 'Edit', 'Delete']);
  });

  it('CONTROL — a name cut, but with sixteen characters\' room, keeps the action', async () => {
    stubName(260, 400);
    renderHeader({ bar: vi.fn(), preview: true });
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(inlineButtons(actionSlot)).toContain('Convert'));
    expect(inlineButtons(actionSlot)).toEqual(['Convert', 'More actions']);
  });

  it('CONTROL — a short name drawn in full keeps the action', async () => {
    stubName(80, 80);
    renderHeader({ bar: vi.fn(), preview: true });
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(inlineButtons(actionSlot)).toContain('Convert'));
    expect(inlineButtons(actionSlot)).toEqual(['Convert', 'More actions']);
  });

  it('CONTROL — a page\'s bar never folds for the name', async () => {
    stubName(120, 300);
    renderHeader({ bar: vi.fn() });
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(inlineButtons(actionSlot)).toContain('Send email'));
    expect(inlineButtons(actionSlot)).toContain('Convert');
  });

  it('CONTROL — a state\'s levers (an approval\'s approve / reject) are drawn as the state draws them', async () => {
    const group = (parts: RecordHeaderGroupParts) => (
      <>
        <button type="button">通过</button>
        <button type="button">拒绝</button>
        {parts.recordMenuItems ? <span data-testid="state-menu" /> : null}
      </>
    );
    renderHeader({ bar: vi.fn(), preview: true, state: { group } });
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(inlineButtons(actionSlot)).toEqual(['通过', '拒绝']));
    expect(actionSlot.querySelector('[data-testid="state-menu"]')).toBeTruthy();
  });
});

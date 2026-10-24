// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11124 — the Automations pillar honours a read-only package on every
 * flow-authoring affordance, and a refused status toggle never leaves the
 * switch showing a state the server refused.
 *
 * Measured on a source-loaded package (`writable: false`): the header
 * "Enabled" switch stayed clickable and saved a draft the server refused with
 * `ITEM_LOCKED`, after which the switch and the canvas status kept the refused
 * value; and the flow inspector was created with a hardcoded `readOnly: false`,
 * so a node edit took on the canvas and was silently thrown away (autosave is
 * blocked on a read-only package). The Data pillar threads its real flag into
 * the inspector since objectui#2259; this pillar now does the same.
 *
 * The canvas and the inspector are the REAL registered `FlowPreview` and
 * `FlowInspector` — the value under test is what they offer the author, so
 * neither is stubbed. The client is a server double whose `save` can refuse.
 * Every read-only case has its writable control in the same file.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.app';

const NODES = [
  { id: 'start', type: 'start', label: 'Start' },
  { id: 'end', type: 'end', label: 'End' },
];
const EDGES = [{ id: 'e1', source: 'start', target: 'end' }];
const FLOW = { name: 'notify_owner', label: 'Notify owner', type: 'autolaunched', status: 'active', nodes: NODES, edges: EDGES };
const OTHER_FLOW = { name: 'nightly_digest', label: 'Nightly digest', type: 'autolaunched', status: 'active', nodes: NODES, edges: EDGES };

const LOCKED_MESSAGE = 'flow/notify_owner belongs to a read-only package and cannot be changed.';

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  saves: [] as Array<{ type: string; name: string; body: Record<string, unknown> }>,
  /** When set, the next draft save waits on this gate before it answers. */
  gate: null as null | Promise<void>,
  /** When true, a draft save is refused the way a locked package refuses it. */
  refuse: false,
}));

const mockClient = vi.hoisted(() => {
  const k = (type: string, name: string) => `${type}/${name}`;
  return {
    list: vi.fn(async (type: string) =>
      [...server.active.entries()]
        .filter(([key]) => key.startsWith(`${type}/`))
        .map(([, row]) => ({ name: row.name, label: row.label ?? row.name })),
    ),
    listDrafts: vi.fn(async () => []),
    listTypes: vi.fn(async () => ({ entries: [] })),
    get: vi.fn(async () => null),
    references: vi.fn(async () => []),
    layered: vi.fn(async (type: string, name: string) => {
      const eff = server.active.get(k(type, name)) ?? null;
      return { code: null, overlay: eff, overlayScope: eff ? 'env' : null, effective: eff, editable: true, deletable: true, resettable: false, lock: 'none' };
    }),
    getDraft: vi.fn(async (type: string, name: string) => {
      throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
    }),
    save: vi.fn(async (type: string, name: string, item: unknown) => {
      server.saves.push({ type, name, body: JSON.parse(JSON.stringify(item)) as Record<string, unknown> });
      if (server.gate) await server.gate;
      if (server.refuse) throw Object.assign(new Error(LOCKED_MESSAGE), { code: 'ITEM_LOCKED', status: 403 });
      return { type, name, item };
    }),
    publish: vi.fn(async () => ({ success: true })),
    reset: vi.fn(async () => ({})),
  };
});

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AutomationsPillar } from './StudioDesignSurface';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { FlowPreview } from '../metadata-admin/previews/FlowPreview';
import { FlowInspector } from '../metadata-admin/inspectors/FlowInspector';
import { t } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

// The pillar's `/automation/_status` probe and the inspector's action-catalog
// read both go through the global `fetch`; one module-scope double answers
// "absent" so each keeps its documented fallback.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

registerMetadataPreview('flow', FlowPreview);
registerMetadataInspector('flow', FlowInspector);

const key = (type: string, name: string) => `${type}/${name}`;

beforeEach(() => {
  server.active.clear();
  server.saves.length = 0;
  server.gate = null;
  server.refuse = false;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  server.active.set(key('flow', FLOW.name), JSON.parse(JSON.stringify(FLOW)));
});

afterEach(cleanup);

function renderPillar(readOnly: boolean) {
  return render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
      <AutomationsPillar packageId={PKG} readOnly={readOnly} />
    </MemoryRouter>,
  );
}

/**
 * The canvas's own status pill. The `_status` probe is answered 404 here, so
 * there is no runtime reading and the pill reads the same `draft.status` the
 * switch reads, in the switch's words (objectui#11779: `active` reads
 * "Enabled", `obsolete` "Disabled").
 */
function canvasStatus(): string {
  return screen.getByText('Status:').nextElementSibling?.textContent ?? '';
}
const STATUS_ON = t('engine.studio.auto.enabled', 'en');
const STATUS_OFF = t('engine.studio.auto.disabled', 'en');
const DRAFT_FOOTER = t('engine.studio.inspector.draftFooter', 'en');

async function openFlow(): Promise<HTMLElement> {
  await waitFor(() => expect(canvasStatus()).toBe(STATUS_ON), { timeout: 8000 });
  return screen.getByRole('switch');
}

/** Select the start node on the canvas; the inspector opens in the right rail. */
async function inspectStartNode(): Promise<HTMLElement> {
  const card = document.querySelector('[data-node-id="start"] [role="button"]') as HTMLElement | null;
  expect(card, 'the canvas must render the start node').not.toBeNull();
  fireEvent.click(card!);
  const rail = screen.getByRole('complementary');
  return within(rail).findByLabelText('Label', undefined, { timeout: 8000 });
}

const READ_ONLY_REASON = 'Read-only package — switch to or create a writable package to edit.';

/** The element an `aria-describedby` names, or `null`. */
const describedBy = (el: HTMLElement) => {
  const id = el.getAttribute('aria-describedby');
  return id ? document.getElementById(id) : null;
};

describe('Automations pillar on a read-only package (objectui#11124)', () => {
  it('disables the header "Enabled" switch, and a click on it saves nothing', async () => {
    renderPillar(true);
    const toggle = await openFlow();

    expect(toggle).toBeDisabled();
    // objectui#12303 — the reason moved from a `title` the disabled switch could
    // never show into the record page's Archive pattern: the switch is
    // described by it, and its wrapper is a tab stop described by it too.
    expect(toggle).not.toHaveAttribute('title');
    expect(describedBy(toggle)).toHaveTextContent(READ_ONLY_REASON);
    const wrapper = toggle.parentElement as HTMLElement;
    expect(wrapper).toHaveAttribute('data-disabled-reason');
    expect(describedBy(wrapper)).toHaveTextContent(READ_ONLY_REASON);
    fireEvent.click(toggle);
    await new Promise((r) => setTimeout(r, 50));
    expect(server.saves).toHaveLength(0);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(canvasStatus()).toBe(STATUS_ON);
  });

  it('a keyboard user reaches the switch’s reason: Tab lands on its wrapper, which opens the tooltip (objectui#12303)', async () => {
    const user = userEvent.setup();
    renderPillar(true);
    const toggle = await openFlow();
    const wrapper = toggle.parentElement as HTMLElement;

    // The control before it in the bar, then one Tab.
    screen.getByRole('button', { name: 'Toggle sidebar' }).focus();
    await user.tab();
    expect(wrapper).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(READ_ONLY_REASON);
  });

  it('opens the flow inspector read-only: the node inputs are disabled', async () => {
    renderPillar(true);
    await openFlow();

    const label = await inspectStartNode();
    expect(label).toBeDisabled();
    expect(within(screen.getByRole('complementary')).getByLabelText('ID')).toBeDisabled();
  });

  it('offers no canvas edit: no "add connected node" or "insert node" handle', async () => {
    renderPillar(true);
    await openFlow();

    expect(screen.queryAllByRole('button', { name: 'Add connected node' })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: 'Insert node here' })).toHaveLength(0);
  });

  // objectui#12453 — a read-only package saves no draft, so its aside does not
  // say edits do; the chip and the header link already say read-only.
  it('the configuration aside carries no draft footer (objectui#12453)', async () => {
    renderPillar(true);
    await openFlow();

    expect(await screen.findByTestId('auto-config-aside')).toBeInTheDocument();
    expect(screen.queryByText(DRAFT_FOOTER)).toBeNull();
  });
});

describe('Automations pillar on a writable package — the control (objectui#11124)', () => {
  it('the configuration aside says edits save as drafts (objectui#12453)', async () => {
    renderPillar(false);
    await openFlow();

    const aside = await screen.findByTestId('auto-config-aside');
    expect(within(aside).getByText(DRAFT_FOOTER)).toBeInTheDocument();
  });


  it('the switch, the inspector and the canvas all still edit', async () => {
    renderPillar(false);
    const toggle = await openFlow();
    expect(toggle).toBeEnabled();
    // objectui#12303 — no read-only reason, and no wrapper, on a writable package.
    expect(toggle).not.toHaveAttribute('aria-describedby');
    expect(toggle.parentElement).not.toHaveAttribute('data-disabled-reason');
    expect(screen.getAllByRole('button', { name: 'Add connected node' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Insert node here' }).length).toBeGreaterThan(0);

    const label = await inspectStartNode();
    expect(label).toBeEnabled();

    fireEvent.click(toggle);
    await waitFor(() => expect(server.saves).toHaveLength(1), { timeout: 8000 });
    expect(server.saves[0]!.body.status).toBe('obsolete');
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'), { timeout: 8000 });
    expect(canvasStatus()).toBe(STATUS_OFF);
  });
});

describe('A refused status toggle rolls back to the server state (objectui#11124)', () => {
  it('returns the switch and the canvas status to the state the toggle started from, and shows the refusal', async () => {
    server.refuse = true;
    renderPillar(false);
    const toggle = await openFlow();

    fireEvent.click(toggle);
    await waitFor(() => expect(server.saves).toHaveLength(1), { timeout: 8000 });
    expect(server.saves[0]!.body.status).toBe('obsolete');

    await screen.findByText(LOCKED_MESSAGE, undefined, { timeout: 8000 });
    await waitFor(() => expect(toggle).toBeEnabled(), { timeout: 8000 });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(canvasStatus()).toBe(STATUS_ON);
  });

  it('puts back only `status`: an edit made while the refused save was in flight survives', async () => {
    let open!: () => void;
    server.gate = new Promise<void>((r) => (open = r));
    server.refuse = true;
    renderPillar(false);
    const toggle = await openFlow();

    fireEvent.click(toggle);
    await waitFor(() => expect(server.saves).toHaveLength(1), { timeout: 8000 });
    expect(canvasStatus()).toBe(STATUS_OFF);

    const label = await inspectStartNode();
    fireEvent.change(label, { target: { value: 'Kick-off' } });
    fireEvent.blur(label);
    await waitFor(() => expect(document.querySelector('[data-node-id="start"]')).toHaveTextContent('Kick-off'), { timeout: 8000 });

    open();
    await screen.findByText(LOCKED_MESSAGE, undefined, { timeout: 8000 });
    await waitFor(() => expect(canvasStatus()).toBe(STATUS_ON), { timeout: 8000 });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(document.querySelector('[data-node-id="start"]')).toHaveTextContent('Kick-off');
  });

  it('never rewrites another flow: a refusal that lands after the author opened a second flow leaves that flow as served', async () => {
    server.active.set(key('flow', OTHER_FLOW.name), { ...JSON.parse(JSON.stringify(OTHER_FLOW)), status: 'obsolete' });
    let open!: () => void;
    server.gate = new Promise<void>((r) => (open = r));
    server.refuse = true;
    renderPillar(false);
    const toggle = await openFlow();

    // notify_owner: active → obsolete, pending.
    fireEvent.click(toggle);
    await waitFor(() => expect(server.saves).toHaveLength(1), { timeout: 8000 });

    // Open the second flow — served with status `obsolete`, the very status the
    // pending toggle wrote — then let the first flow's save be refused.
    fireEvent.click(screen.getByRole('button', { name: /Nightly digest/ }));
    await waitFor(() => expect(screen.getByTitle('API name: nightly_digest')).toBeInTheDocument(), { timeout: 8000 });
    await waitFor(() => expect(canvasStatus()).toBe(STATUS_OFF), { timeout: 8000 });

    open();
    await screen.findByText(LOCKED_MESSAGE, undefined, { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(canvasStatus()).toBe(STATUS_OFF);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });
});

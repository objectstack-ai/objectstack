// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11779 — the flow state Studio shows is the state the deployment
 * runs, and it reads the same in the Automations rail, the flow header and the
 * Problems panel.
 *
 * Measured in a browser QA pass before this card:
 *   - a record-triggered flow's header read "Trigger: autolaunched" (the
 *     flow-level `type`, not the Start node's `triggerType`);
 *   - a published flow with no `status` key read "Status: draft" in the header
 *     while the rail read "On";
 *   - a schedule flow the deployment does not arm read a green "On" in the
 *     rail, "active" in the header and "no problems" in Problems;
 *   - the bar promised "Off by default", and a new flow's switch read Enabled.
 *
 * Driven through the REAL `AutomationsPillar` with the REAL registered
 * `FlowPreview` (its header pills and its Problems panel) — the value under
 * test is what the author reads, so neither is stubbed. The `_status` double
 * is a router: it serves the engine's runtime rows on the one route, in the
 * shape `getFlowRuntimeStates()` puts on the wire (`triggerType` / `reason`
 * omitted where the engine omits them), and answers every other URL 404. The
 * reason is fixture text, ⛔ not a platform sentence: the surfaces show
 * whatever string arrives.
 *
 * The assertions name the designer-table KEY each string must come from, so a
 * reworded row turns nothing green or red.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FlowSchema } from '@objectstack/spec/automation';

const PKG = 'com.acme.app';

const REASON = 'FIXTURE: the platform sentence for why this flow is not armed, rendered as sent.';

const edges = [{ id: 'e1', source: 'start', target: 'end' }];
const end = { id: 'end', type: 'end', label: 'End' };

/** Published flows. None carries a `status` key — the shape the QA pass read. */
const FLOWS: Array<Record<string, unknown>> = [
  {
    name: 'notify_on_update',
    label: 'Notify on update',
    type: 'autolaunched',
    nodes: [
      { id: 'start', type: 'start', label: 'Start', config: { triggerType: 'record-after-update', objectName: 'task' } },
      end,
    ],
    edges,
  },
  {
    name: 'task_due_reminder',
    label: 'Task due reminder',
    type: 'schedule',
    nodes: [{ id: 'start', type: 'start', label: 'Start', config: { schedule: { type: 'cron', expression: '0 7 * * *' } } }, end],
    edges,
  },
  {
    // objectui#12845 — the stock showcase's interval cadence (`showcase_scheduled_digest`).
    name: 'scheduled_digest',
    label: 'Scheduled digest',
    type: 'schedule',
    nodes: [{ id: 'start', type: 'start', label: 'Start', config: { schedule: { type: 'interval', intervalMs: 60000 } } }, end],
    edges,
  },
  {
    name: 'approve_manually',
    label: 'Approve manually',
    type: 'autolaunched',
    nodes: [{ id: 'start', type: 'start', label: 'Start' }, end],
    edges,
  },
  {
    name: 'never_published',
    label: 'Never published',
    type: 'autolaunched',
    nodes: [{ id: 'start', type: 'start', label: 'Start' }, end],
    edges,
  },
];

/** The engine's runtime rows. `never_published` has none: the engine does not have it. */
const RUNTIME_ROWS = [
  // Bound to its record trigger and running — the control.
  { name: 'notify_on_update', enabled: true, bound: true, triggerType: 'record_change', object: 'task' },
  // A schedule flow the deployment holds unarmed.
  { name: 'task_due_reminder', enabled: true, bound: false, triggerType: 'schedule', reason: REASON },
  // A schedule flow on an interval cadence, bound.
  { name: 'scheduled_digest', enabled: true, bound: true, triggerType: 'schedule' },
  // No declared trigger: runs when invoked.
  { name: 'approve_manually', enabled: true, bound: false },
];

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, Record<string, unknown>>(),
  saves: [] as Array<{ type: string; name: string; body: Record<string, unknown> }>,
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
      const body = server.drafts.get(k(type, name));
      if (body) return { item: JSON.parse(JSON.stringify(body)) };
      throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
    }),
    save: vi.fn(async (type: string, name: string, item: unknown) => {
      const body = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
      server.saves.push({ type, name, body });
      server.drafts.set(k(type, name), body);
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
import { FlowPreview } from '../metadata-admin/previews/FlowPreview';
import { t } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

registerMetadataPreview('flow', FlowPreview);

const AUTOMATION_STATUS_ROUTE = '/api/v1/automation/_status';
const routeOf = (url: string) => url.split('?')[0];
let fetchCalls: string[] = [];

beforeEach(() => {
  fetchCalls = [];
  server.active.clear();
  server.drafts.clear();
  server.saves.length = 0;
  for (const f of FLOWS) server.active.set(`flow/${String(f.name)}`, JSON.parse(JSON.stringify(f)));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input);
      fetchCalls.push(url);
      if (routeOf(url) !== AUTOMATION_STATUS_ROUTE) {
        return new Response('null', { status: 404, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ success: true, data: { flows: RUNTIME_ROWS, total: RUNTIME_ROWS.length } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  expect(fetchCalls.filter((url) => routeOf(url) === AUTOMATION_STATUS_ROUTE).length).toBeGreaterThan(0);
  cleanup();
  vi.unstubAllGlobals();
});

function renderPillar() {
  return render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
      <AutomationsPillar packageId={PKG} />
    </MemoryRouter>,
  );
}

const en = (key: string) => t(key, 'en');

/** The rail row's status element (the dot or the chip) for the flow labelled `label`. */
async function railStatus(label: string): Promise<HTMLElement> {
  const row = await screen.findByRole('button', { name: new RegExp(label) }, { timeout: 8000 });
  let el: HTMLElement | null = null;
  await waitFor(
    () => {
      el = row.querySelector('span[title]');
      expect(el).not.toBeNull();
    },
    { timeout: 8000 },
  );
  return el!;
}

/** The header pill whose label is `label` (e.g. "Status"): the pill element and its value. */
function headerPill(label: string): { pill: HTMLElement; value: string } {
  const labelEl = screen.getByText(`${label}:`);
  return { pill: labelEl.parentElement as HTMLElement, value: labelEl.nextElementSibling?.textContent ?? '' };
}

/** Open the flow labelled `label` from the rail and wait until its header names it (the API name on the chip's tooltip). */
async function openFlow(label: string, name: string): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(label) }, { timeout: 8000 }));
  await screen.findByTitle(`API name: ${name}`, undefined, { timeout: 8000 });
  await screen.findByText('Status:', undefined, { timeout: 8000 });
}

/** The header Status pill once it reads `value` — the runtime answer is fetched asynchronously. */
async function statusPillReads(value: string): Promise<HTMLElement> {
  await waitFor(() => expect(headerPill('Status').value).toBe(value), { timeout: 8000 });
  return headerPill('Status').pill;
}

/** Open the header's Problems panel (one flow preview is on screen, so one panel). */
function openProblems(): void {
  fireEvent.click(screen.getByTitle(en('engine.flowPreview.problemsTitle')));
}

describe('the header Trigger pill reads the Start node (objectui#11779)', () => {
  it('a record-triggered flow shows its trigger event and object, not the flow type "autolaunched"', async () => {
    renderPillar();
    await openFlow('Notify on update', 'notify_on_update');
    const { value } = headerPill('Trigger');
    expect(value).toBe('Record updated · task');
    expect(value).not.toMatch(/autolaunched/);
  });

  it('a schedule flow reads as a schedule; a manual flow falls back to its type', async () => {
    renderPillar();
    await openFlow('Task due reminder', 'task_due_reminder');
    expect(headerPill('Trigger').value).toBe('Schedule');
    await openFlow('Approve manually', 'approve_manually');
    expect(headerPill('Trigger').value).toBe('autolaunched');
  });

  // objectui#12845 — the label names the schedule KIND, not one cadence: an
  // interval flow reads exactly what the cron flow above reads, never "cron".
  it('an interval schedule flow reads the same Schedule label as a cron one, never cron', async () => {
    renderPillar();
    await openFlow('Scheduled digest', 'scheduled_digest');
    expect(headerPill('Trigger').value).toBe('Schedule');
    expect(headerPill('Trigger').value).not.toMatch(/cron/i);
  });
});

describe('one run status in the rail, the header and Problems (objectui#11779)', () => {
  it('a published flow with no `status` key reads On in the rail and the header, never "draft" — the control', async () => {
    renderPillar();
    const dot = await railStatus('Notify on update');
    expect(dot).toHaveTextContent(en('engine.studio.auto.on'));
    expect(dot).toHaveAttribute('title', en('engine.studio.auto.onBound'));

    await openFlow('Notify on update', 'notify_on_update');
    const pill = await statusPillReads(en('engine.studio.auto.on'));
    expect(pill).toHaveAttribute('title', en('engine.studio.auto.onBound'));
    expect(headerPill('Status').value).not.toMatch(/draft/i);
    expect(pill.innerHTML).toMatch(/emerald/);
  });

  it('an unbound schedule flow reads "Not running here" in the rail and the header alike, titled with the reason, and not On', async () => {
    renderPillar();
    const chip = await railStatus('Task due reminder');
    expect(chip).toHaveTextContent(en('engine.studio.auto.notRunning'));
    expect(chip).toHaveAttribute('title', REASON);
    expect(chip).not.toHaveTextContent(en('engine.studio.auto.on'));

    await openFlow('Task due reminder', 'task_due_reminder');
    const pill = await statusPillReads(en('engine.studio.auto.notRunning'));
    expect(pill).toHaveAttribute('title', REASON);
    expect(pill.innerHTML).not.toMatch(/emerald|destructive/);
  });

  it('Problems says so too: a note carrying the reason, not counted as a problem and not an error', async () => {
    renderPillar();
    await openFlow('Task due reminder', 'task_due_reminder');
    await statusPillReads(en('engine.studio.auto.notRunning'));
    openProblems();
    const note = await screen.findByTestId('flow-run-status-note');
    expect(note).toHaveTextContent(en('engine.studio.auto.notRunning'));
    expect(note).toHaveTextContent(REASON);
    expect(note.innerHTML).not.toMatch(/destructive/);
    // The structural verdict stands: a deployment policy is not an authoring problem.
    expect(screen.getByText(en('engine.flowProblems.empty'))).toBeInTheDocument();
  });

  it('a flow with no declared trigger reads On, says "no trigger", and gets no Problems note — the control', async () => {
    renderPillar();
    const dot = await railStatus('Approve manually');
    expect(dot).toHaveTextContent(en('engine.studio.auto.on'));
    expect(dot).toHaveAttribute('title', en('engine.studio.auto.onUnbound'));

    await openFlow('Approve manually', 'approve_manually');
    const pill = await statusPillReads(en('engine.studio.auto.on'));
    expect(pill).toHaveAttribute('title', en('engine.studio.auto.onUnbound'));
    openProblems();
    await screen.findByText(en('engine.flowProblems.empty'));
    expect(screen.queryByTestId('flow-run-status-note')).toBeNull();
  });

  it('a flow the engine does not have reads as an unpublished draft in the header, and carries no rail status', async () => {
    renderPillar();
    await railStatus('Notify on update'); // the runtime rows are in
    await openFlow('Never published', 'never_published');
    await statusPillReads(en('engine.studio.unpublishedDraft'));
    const row = screen.getByRole('button', { name: /Never published/ });
    expect(row.querySelector('span[title]')).toBeNull();
  });
});

describe('a new flow is born switched off, as the bar promises (objectui#11779)', () => {
  it('"New" saves `status: obsolete`, a spec-valid flow, and the switch reads Disabled under "Off by default"', async () => {
    renderPillar();
    await railStatus('Notify on update');
    expect(screen.getByText(en('engine.studio.auto.defaultOff'))).toBeInTheDocument();

    fireEvent.click(screen.getByTitle(en('engine.studio.auto.newTitle')));
    fireEvent.change(await screen.findByPlaceholderText(en('engine.studio.auto.namePlaceholder')), {
      target: { value: 'Offer notice' },
    });
    // objectui#11861 — the blank flow is the dialog's *Advanced* choice.
    fireEvent.click(screen.getByRole('radio', { name: en('engine.studio.rules.advanced') }));
    fireEvent.click(screen.getByRole('button', { name: en('engine.studio.createDraft') }));

    await waitFor(() => expect(server.saves).toHaveLength(1), { timeout: 8000 });
    const { name, body } = server.saves[0]!;
    expect(name).toBe('offer_notice');
    expect(body.status).toBe('obsolete');
    const parsed = FlowSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);

    const toggle = await screen.findByRole('switch', undefined, { timeout: 8000 });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveTextContent(en('engine.studio.auto.disabled'));
  });
});

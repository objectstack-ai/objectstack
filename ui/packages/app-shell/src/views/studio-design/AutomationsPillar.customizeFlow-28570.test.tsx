// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28570 (ADR-0146 D9 items 1–3, D2, D4) — on a read-only base,
 * the Automations pillar customizes a flow into the base's paired
 * customization package, under the flow's own name, as a declared override.
 *
 * Through the mounted pillar, its real autosave, the real header controls and
 * the real ensure-door client (`ensureCustomizationPackage`) over a fetch stub
 * that also serves the `/automation` doors. The metadata client is a server
 * double holding the base's flow, the pair's row and the pair's draft, and
 * recording every write. The pillar is handed what the Studio surface hands
 * it (`StudioBaseCustomization`) by a host that takes the pair's id from the
 * door's answer, as `InterfacesPillar.customize-28562`'s does.
 *
 * Pinned:
 *  - Customize is offered on the base's flow and writes nothing; the first
 *    saved edit asks the door once and writes the pair's draft under the
 *    flow's name, the served body without `_` keys, declaring the override;
 *    no ledger row is written and the base is untouched;
 *  - the open override keeps the ledger switch on the flow's name, and no
 *    definition switch is drawn; the badge reads the served declaration;
 *  - Restore is decided from the declared override's own row even though
 *    the served envelope says `deletable: false`; it deletes the pair's
 *    draft and row, and the base's flow reads back;
 *  - a walled tenant admin sees Customize disabled, and nothing is asked;
 *  - a refused save and a refused publish read as the server sent them;
 *  - CONTROLS: the base's flow with no override offers no Restore; a
 *    writable package's flow keeps Delete flow and its definition switch.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const BASE = 'com.example.hotcrm';
const PAIR = 'com.example.hotcrm.custom';
const FLOW_NAME = 'notify_owner';

/** The base's flow as its read serves it: the protection envelope rides along. */
const BASE_FLOW: Record<string, unknown> = {
  name: FLOW_NAME,
  label: 'Notify owner',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
  _packageId: BASE,
  _lock: 'full',
};
const DECLARATION = { package: BASE, basedOn: '4.0.0' };
const strip = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('_')));

// ── The published posture facts ───────────────────────────────────────────

let posture: string | undefined;
let operator: boolean | undefined;

vi.mock('../../hooks/useTenancyPosture', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTenancyPosture: () => posture,
}));
vi.mock('@object-ui/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/auth')>();
  return {
    ...mod,
    useAuth: () => ({
      ...mod.useAuth(),
      user: { id: 'u_caller', name: 'Caller', email: 'caller@example.com', isPlatformAdmin: operator },
    }),
  };
});

// ── The metadata server, doubled at the client ─────────────────────────────

const srv = vi.hoisted(() => ({
  base: null as Record<string, unknown> | null,
  pairActive: null as Record<string, unknown> | null,
  pairDraft: null as Record<string, unknown> | null,
  pairExists: false,
  ensure: [] as number[],
  saveRefusal: null as null | { status: number; message: string },
  saves: [] as Array<{ name: string; body: Record<string, unknown>; opts: Record<string, unknown> }>,
  resets: [] as Array<{ name: string; opts: Record<string, unknown> }>,
  version: 0,
  /** Whether the engine's `_status` answer holds a row for the flow. */
  statusRow: true,
}));

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async (type: string, opts: { packageId?: string } = {}) =>
    type === 'flow' && opts.packageId !== PAIR ? [{ name: FLOW_NAME, label: 'Notify owner' }] : [],
  ),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  // N-11: the pair's row is served over the base's flow, in the base's slot,
  // and the envelope keeps following the base's seal (`deletable: false`).
  layered: vi.fn(async () => ({
    code: srv.base ? clone(srv.base) : null,
    overlay: srv.pairActive ? clone({ ...srv.pairActive, _packageId: BASE }) : null,
    overlayScope: srv.pairActive ? 'env' : null,
    effective: clone(srv.pairActive ? { ...srv.pairActive, _packageId: BASE } : srv.base),
    lock: 'full',
    editable: false,
    deletable: false,
    resettable: false,
  })),
  getDraft: vi.fn(async (type: string, name: string, opts: { packageId?: string } = {}) => {
    if (opts.packageId === PAIR && srv.pairDraft) {
      return { type, name, item: clone(srv.pairDraft), version: `v${srv.version}` };
    }
    throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
  }),
  save: vi.fn(async (_type: string, name: string, item: unknown, opts: Record<string, unknown> = {}) => {
    srv.saves.push({ name, body: clone(item) as Record<string, unknown>, opts: clone(opts) });
    if (srv.saveRefusal) {
      throw Object.assign(new Error(srv.saveRefusal.message), { status: srv.saveRefusal.status });
    }
    if (opts.packageId !== PAIR) {
      throw Object.assign(new Error(`Package '${String(opts.packageId)}' is read-only.`), { status: 403 });
    }
    srv.pairDraft = clone(item) as Record<string, unknown>;
    srv.version += 1;
    return { success: true, version: `v${srv.version}`, state: 'draft' };
  }),
  reset: vi.fn(async (_type: string, name: string, opts: Record<string, unknown> = {}) => {
    srv.resets.push({ name, opts: clone(opts) });
    if (opts.packageId === PAIR) {
      if (opts.state === 'draft') srv.pairDraft = null;
      else srv.pairActive = null;
    }
    return { success: true };
  }),
}));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { AutomationsPillar, type StudioBaseCustomization } from './StudioDesignSurface';
import { ensureCustomizationPackage } from './packages-io';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { publishRefusal } from './metadataError';
import { t, tFormat } from '../metadata-admin/i18n';
import { createEmptyDataSource } from './__tests__/emptyDataSource';

const dataSource = createEmptyDataSource();

/** The flow canvas, reduced to its label and one in-place edit. */
function FlowCanvas({ draft, onPatch }: { draft: Record<string, unknown>; onPatch?: (patch: Record<string, unknown>) => void }) {
  return (
    <div>
      <p data-testid="flow-label">{String(draft?.label ?? '')}</p>
      <button type="button" onClick={() => onPatch?.({ label: `${String(draft?.label ?? '')} (ours)` })}>
        patch the flow
      </button>
    </div>
  );
}

// ── The ensure door and the `/automation` doors, doubled at fetch ───────────

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = new URL(String(input), 'http://localhost').pathname;
  if (path.endsWith('/automation/_status')) {
    return json({ success: true, data: { flows: srv.statusRow ? [{ name: FLOW_NAME, enabled: true, bound: true }] : [] } });
  }
  if (path.endsWith('/toggle')) return json({ success: true, data: { name: FLOW_NAME, enabled: false } });
  if (path === `/api/v1/packages/${BASE}/ensure-customization` && init?.method === 'POST') {
    const created = !srv.pairExists;
    srv.pairExists = true;
    srv.ensure.push(created ? 201 : 200);
    return json(
      {
        success: true,
        data: { basePackageId: BASE, packageId: PAIR, namespace: 'hotcrm_custom', dependencyRange: '^4', created, writable: true },
      },
      created ? 201 : 200,
    );
  }
  return json(null, 404);
});
const calls = (suffix: string) => fetchMock.mock.calls.filter(([u]) => String(u).endsWith(suffix));

beforeAll(() => {
  registerMetadataPreview('flow', FlowCanvas as never);
});

beforeEach(() => {
  posture = 'single';
  operator = false;
  srv.base = clone(BASE_FLOW);
  srv.pairActive = null;
  srv.pairDraft = null;
  srv.pairExists = false;
  srv.ensure.length = 0;
  srv.saveRefusal = null;
  srv.saves.length = 0;
  srv.resets.length = 0;
  srv.version = 0;
  srv.statusRow = true;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** What the Studio surface hands the pillar on a read-only base: the pair's id comes from the door's answer. */
function Host({
  readOnly = true,
  walled = false,
  listedPair = null,
}: {
  readOnly?: boolean;
  walled?: boolean;
  listedPair?: string | null;
}) {
  const [pairId, setPairId] = React.useState<string | null>(listedPair);
  const ensurePackage = React.useCallback(async () => {
    const answer = await ensureCustomizationPackage(BASE);
    setPairId(answer.packageId);
    return answer;
  }, []);
  const ensure = React.useCallback(async () => (await ensurePackage()).packageId, [ensurePackage]);
  const customization = React.useMemo<StudioBaseCustomization | null>(
    () =>
      readOnly
        ? { base: BASE, baseLabel: 'HotCRM', basedOn: '4.0.0', walled, pairId, ensure, ensurePackage, marks: { status: 'off' } }
        : null,
    [readOnly, walled, pairId, ensure, ensurePackage],
  );
  return <AutomationsPillar packageId={BASE} readOnly={readOnly} customization={customization} />;
}

function mount(props: React.ComponentProps<typeof Host> = {}) {
  return render(
    <MemoryRouter initialEntries={[`/studio/${BASE}/automations`]}>
      <Host {...props} />
    </MemoryRouter>,
  );
}

const header = () => screen.getByTestId('auto-flow-header');
const patchFlow = () => fireEvent.click(screen.getByRole('button', { name: 'patch the flow' }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openFlow(label = /^Notify owner/): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('flow-label')).toHaveTextContent(label), { timeout: 8000 });
}

async function customize(): Promise<void> {
  fireEvent.click(await within(header()).findByTestId('studio-customize', undefined, { timeout: 8000 }));
  await waitFor(() => expect(within(header()).queryByTestId('studio-customize')).toBeNull());
}

async function openMenu(): Promise<void> {
  fireEvent.pointerDown(await screen.findByTestId('auto-item-more', undefined, { timeout: 8000 }), { button: 0, ctrlKey: false });
  await screen.findByTestId('auto-item-new-similar');
}

/** The one switch drawn in the header is the ledger's: no definition switch beside it. */
async function expectLedgerSwitchAlone(): Promise<void> {
  const ledger = await within(header()).findByTestId('auto-ledger-switch', undefined, { timeout: 8000 });
  expect(ledger).toHaveAttribute('aria-checked', 'true');
  expect(within(header()).getAllByRole('switch')).toEqual([ledger]);
  expect(header()).not.toHaveTextContent(t('engine.studio.auto.enabled', 'en'));
}

describe('Customize a read-only base’s flow into its pair (objectstack#28570)', () => {
  it('Customize is offered and writes nothing; until it is pressed the canvas edits nothing', async () => {
    mount();
    await openFlow();
    expect(within(header()).getByTestId('studio-customize')).toBeEnabled();

    patchFlow();
    expect(screen.getByTestId('flow-label')).toHaveTextContent(/^Notify owner$/);

    await customize();
    await sleep(1500);
    expect(srv.ensure).toEqual([]);
    expect(srv.saves).toEqual([]);
    expect(within(header()).queryByTestId('studio-override-chip')).toBeNull();
    // Unlocked, it is switched by the ledger row alone.
    await expectLedgerSwitchAlone();
  });

  it('the first saved edit asks the door once and writes the pair’s draft under the flow’s name, declaring the override; no ledger row is written', async () => {
    mount();
    await openFlow();
    await customize();

    patchFlow();
    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 8000 });
    expect(srv.ensure).toEqual([201]);
    const [saved] = srv.saves;
    expect(saved!.name).toBe(FLOW_NAME);
    expect(saved!.opts).toMatchObject({ mode: 'draft', packageId: PAIR, surface: 'studio', ifNoneMatch: '*' });
    expect(saved!.body).toStrictEqual({ ...strip(BASE_FLOW), label: 'Notify owner (ours)', overrides: DECLARATION });
    // The base's flow is untouched, and nothing reached the ledger door.
    expect(srv.base).toStrictEqual(BASE_FLOW);
    expect(calls('/toggle')).toHaveLength(0);

    // The badge reads the declaration the pair's draft now serves.
    const chip = await within(header()).findByTestId('studio-override-chip', undefined, { timeout: 8000 });
    expect(chip).toHaveTextContent(tFormat('engine.studio.customize.overrides', 'en', { package: 'HotCRM' }));
    expect(chip).toHaveAttribute('title', tFormat('engine.studio.customize.overridesTitle', 'en', { package: 'HotCRM', basedOn: '4.0.0' }));
    await expectLedgerSwitchAlone();

    // A later edit asks the door no more, and is pinned to the version it was answered.
    patchFlow();
    await waitFor(() => expect(srv.saves).toHaveLength(2), { timeout: 8000 });
    expect(srv.ensure).toEqual([201]);
    expect(srv.saves[1]!.opts).toMatchObject({ packageId: PAIR, ifMatch: 'v1' });
    expect(srv.saves[1]!.body.overrides).toEqual(DECLARATION);
    expect(calls('/toggle')).toHaveLength(0);
  });

  it('a published override keeps the ledger switch and draws no definition switch; Restore is read from its row, not from the envelope', async () => {
    srv.pairActive = { ...strip(BASE_FLOW), label: 'Notify owner and manager', overrides: DECLARATION };
    srv.pairExists = true;
    mount({ listedPair: PAIR });
    await openFlow(/^Notify owner and manager$/);

    expect(await within(header()).findByTestId('studio-override-chip', undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(within(header()).queryByTestId('studio-customize')).toBeNull();
    await expectLedgerSwitchAlone();

    // The layered envelope says `deletable: false`; the declared row decides.
    await openMenu();
    expect(screen.getByTestId('studio-restore-original')).not.toHaveAttribute('data-disabled');
    // Delete flow stays a writable package's own.
    expect(screen.queryByTestId('auto-item-delete')).toBeNull();

    // Its editors are open: an edit is saved into the pair, keeping the declaration.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    patchFlow();
    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 8000 });
    expect(srv.saves[0]!.opts.packageId).toBe(PAIR);
    expect(srv.saves[0]!.body.overrides).toEqual(DECLARATION);
    expect(srv.ensure).toEqual([200]);
  });

  it('Restore confirms that the base’s flow runs again, deletes the pair’s draft and row, and the base’s flow reads back', async () => {
    srv.pairActive = { ...strip(BASE_FLOW), label: 'Notify owner and manager', overrides: DECLARATION };
    srv.pairDraft = { ...strip(BASE_FLOW), label: 'Notify owner and manager v2', overrides: DECLARATION };
    srv.pairExists = true;
    mount({ listedPair: PAIR });
    await openFlow(/^Notify owner and manager v2$/);

    await openMenu();
    fireEvent.click(screen.getByTestId('studio-restore-original'));
    const dialog = await screen.findByTestId('studio-restore-original-dialog');
    const vars = { item: 'Notify owner', package: 'HotCRM' };
    expect(dialog).toHaveTextContent(tFormat('engine.studio.customize.restoreConfirm', 'en', vars));
    expect(dialog).toHaveTextContent(tFormat('engine.studio.customize.restoreFlowBody', 'en', vars));
    expect(dialog).toHaveTextContent(t('engine.studio.customize.restoreDraft', 'en'));
    fireEvent.click(within(dialog).getByTestId('studio-restore-original-confirm'));

    await waitFor(() => expect(srv.resets).toHaveLength(2), { timeout: 8000 });
    expect(srv.resets).toEqual([
      { name: FLOW_NAME, opts: { state: 'draft', packageId: PAIR } },
      { name: FLOW_NAME, opts: { packageId: PAIR } },
    ]);
    await openFlow(/^Notify owner$/);
    await waitFor(() => expect(within(header()).queryByTestId('studio-override-chip')).toBeNull(), { timeout: 8000 });
    expect(await within(header()).findByTestId('studio-customize')).toBeEnabled();
    expect(srv.saves).toEqual([]);
    expect(calls('/toggle')).toHaveLength(0);
  });

  it('with no ledger row served, a customized flow draws no switch at all, where the base’s own flow keeps its locked one', async () => {
    srv.statusRow = false;
    mount();
    await openFlow();
    // CONTROL: the base's flow, not customized, keeps the read-only definition switch.
    expect(within(header()).getByRole('switch')).toBeDisabled();
    expect(within(header()).queryByTestId('auto-ledger-switch')).toBeNull();

    await customize();
    expect(within(header()).queryByRole('switch')).toBeNull();
    patchFlow();
    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 8000 });
    await within(header()).findByTestId('studio-override-chip', undefined, { timeout: 8000 });
    expect(within(header()).queryByRole('switch')).toBeNull();
    // Studio never writes the override's status to mean on or off.
    expect(srv.saves[0]!.body.status).toBe(BASE_FLOW.status);
    expect(calls('/toggle')).toHaveLength(0);
  });

  it('a walled tenant admin sees Customize disabled, with the reason; nothing is asked or sent', async () => {
    posture = 'group';
    operator = false;
    mount({ walled: true });
    await openFlow();
    const button = within(header()).getByTestId('studio-customize');
    expect(button).toBeDisabled();
    expect(within(header()).getByTestId('studio-customize-blocked')).toHaveAttribute(
      'title',
      t('engine.studio.customize.walled', 'en'),
    );
    fireEvent.click(button);
    patchFlow();
    await sleep(1500);
    expect(screen.getByTestId('flow-label')).toHaveTextContent(/^Notify owner$/);
    expect(srv.ensure).toEqual([]);
    expect(srv.saves).toEqual([]);
  });

  it('a refused save into the pair is shown as the server sent it', async () => {
    const sentence = "Package 'com.example.hotcrm.custom' cannot declare an override of 'com.example.hotcrm' for flow 'notify_owner'.";
    srv.saveRefusal = { status: 403, message: sentence };
    mount();
    await openFlow();
    await customize();
    patchFlow();
    expect(await screen.findByTestId('studio-refusal-message', undefined, { timeout: 8000 })).toHaveTextContent(sentence);
    expect(within(header()).queryByTestId('studio-override-chip')).toBeNull();
  });

  it('a refused publish of the pair’s flow reads with the server’s sentence as sent', () => {
    const sentence = "flow 'notify_owner' declares an override of 'com.example.hotcrm' at 3.0.0, but 4.0.0 is installed.";
    const refusal = publishRefusal({ type: 'flow', name: FLOW_NAME, error: sentence }, 'flow', null, 'en');
    expect(refusal.message).toBe(tFormat('engine.studio.refusal.publishPlain', 'en', { reason: sentence }));
    expect(refusal.message).toContain(sentence);
  });

  it('CONTROL: the base’s flow with no override offers no Restore', async () => {
    mount({ listedPair: PAIR });
    await openFlow();
    await openMenu();
    expect(screen.queryByTestId('studio-restore-original')).toBeNull();
    expect(screen.queryByTestId('auto-item-delete')).toBeNull();
  });

  it('CONTROL: a writable package’s flow keeps Delete flow and its definition switch, with no Customize', async () => {
    mount({ readOnly: false });
    await openFlow();
    expect(within(header()).queryByTestId('studio-customize')).toBeNull();
    expect(within(header()).queryByTestId('auto-ledger-switch')).toBeNull();
    expect(within(header()).getByRole('switch')).toHaveTextContent(t('engine.studio.auto.enabled', 'en'));
    await openMenu();
    expect(screen.getByTestId('auto-item-delete')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-restore-original')).toBeNull();
  });
});

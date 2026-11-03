// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29079 — the metadata editor page tells a read-only scoped
 * inspector WHY it is read-only (`MetadataInspectorProps.readOnlyReason`), with
 * the sentence the page's own notice gives for the cause in force.
 *
 * The page folds its causes into one `formReadOnly`; the inspector cannot tell
 * them apart, so the reason is the host's. Each case opens a flow on this page,
 * selects a node on the canvas and reads the node inspector's described group
 * (`FlowNodeInspector`, which draws it only when a reason arrives). The walled
 * catalog applies to the security catalog types alone, none of which ships a
 * scoped inspector, so its case registers one for `position` through the
 * public registry, as a host would.
 *
 * Stubbed: the flow and position canvases (only to emit a selection, which is
 * the canvas's own concern) and the data reads. The page, its gates and the
 * node inspector are real.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { MetadataAreaHostContext, type MetadataAreaHost } from './metadataAreaHost';

const FLOW = {
  name: 'close_case',
  label: 'Close case',
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'set_status', type: 'update_record', label: 'Set status', config: { objectName: 'task', fields: { status: 'done' } } },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'set_status' },
    { id: 'e2', source: 'set_status', target: 'end' },
  ],
};

const POSITION = { name: 'sales_rep', label: 'Sales rep' };

const OBJECT = { name: 'task', label: 'Task', fields: { title: { type: 'text', label: 'Title' } } };

/** The layered envelope each case serves; reset per test. */
let layered: Record<string, unknown> = {};
let canAuthor = true;
let walled = false;

const client = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => null),
  getDraft: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => layered),
  saveDraft: vi.fn(async () => ({})),
  save: vi.fn(async () => ({})),
};

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
  // The registry rows as the spec declares them (`DEFAULT_METADATA_TYPE_REGISTRY`).
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [
      { type: 'flow', label: 'Flow', domain: 'automation', allowEnvironmentOverlay: false, allowRuntimeCreate: true },
      { type: 'position', label: 'Position', domain: 'security', allowEnvironmentOverlay: false, allowRuntimeCreate: true },
      { type: 'object', label: 'Object', domain: 'data', allowEnvironmentOverlay: false, allowRuntimeCreate: true },
    ],
  }),
}));
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => canAuthor,
  useCanReadAuthoringTrail: () => false,
}));
vi.mock('./catalog-scope', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWalledCatalogReadOnly: (type: string) => walled && type === 'position',
}));
vi.mock('./previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('./previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('not found', { status: 404 })),
);

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerBuiltinInspectors } from './inspectors';
import { registerMetadataPreview, getMetadataPreview, type MetadataSelection } from './preview-registry';
import {
  registerMetadataInspector,
  getMetadataInspector,
  type MetadataInspectorProps,
} from './inspector-registry';
import { t, tFormat } from './i18n';

registerBuiltinInspectors();

/** Canvas stand-in: emits the selection the real canvas emits on a click. */
function stubCanvas(selection: MetadataSelection) {
  return function StubCanvas({ onSelectionChange }: { onSelectionChange?: (next: MetadataSelection | null) => void }) {
    return (
      <button type="button" onClick={() => onSelectionChange?.(selection)}>
        select on canvas
      </button>
    );
  };
}

/** A host's inspector for a type that ships none: it draws what it is handed. */
function HostPositionInspector({ readOnly, readOnlyReason }: MetadataInspectorProps) {
  return (
    <div data-testid="host-position-inspector" data-readonly={String(readOnly)}>
      {readOnlyReason ?? ''}
    </div>
  );
}

const realFlowPreview = getMetadataPreview('flow');
const realPositionPreview = getMetadataPreview('position');
const realPositionInspector = getMetadataInspector('position');
const realObjectPreview = getMetadataPreview('object');

beforeEach(() => {
  layered = { effective: FLOW, code: null, overlay: null, editable: true, deletable: true };
  canAuthor = true;
  walled = false;
  registerMetadataPreview('flow', stubCanvas({ kind: 'node', id: 'set_status', label: 'Set status' }) as never);
  registerMetadataPreview('position', stubCanvas({ kind: 'node', id: 'sales_rep', label: 'Sales rep' }) as never);
  registerMetadataInspector('position', HostPositionInspector);
  registerMetadataPreview('object', stubCanvas({ kind: 'field', id: 'title', label: 'Title' }) as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  if (realFlowPreview) registerMetadataPreview('flow', realFlowPreview);
  if (realPositionPreview) registerMetadataPreview('position', realPositionPreview);
  if (realPositionInspector) registerMetadataInspector('position', realPositionInspector);
  if (realObjectPreview) registerMetadataPreview('object', realObjectPreview);
});

const READ_ONLY_HOST: MetadataAreaHost = {
  packageId: 'com.vendor.hr',
  readOnly: true,
  basePath: '/studio/com.vendor.hr/metadata',
};

/** Open the item, then select on the canvas so the scoped inspector mounts. */
async function openAndSelect(type: string, name: string, host: MetadataAreaHost | null = null) {
  const url = host ? `${host.basePath}/${type}/${name}` : `/apps/setup/metadata/${type}/${name}`;
  const tree = (
    <MemoryRouter initialEntries={[url]}>
      <MetadataResourceEditPage type={type} name={name} />
    </MemoryRouter>
  );
  render(host ? <MetadataAreaHostContext.Provider value={host}>{tree}</MetadataAreaHostContext.Provider> : tree);
  fireEvent.click(await screen.findByRole('button', { name: 'select on canvas' }));
}

/** The node inspector's reason, as its accessible description resolves. */
async function nodeInspectorReason(): Promise<string | null> {
  // The inspector is mounted once its Remove-node control is.
  await screen.findByRole('button', { name: t('engine.inspector.flowNode.remove', 'en-US') });
  const group = document.querySelector<HTMLElement>('[data-testid="flow-node-readonly-reason"]');
  if (!group) return null;
  const id = group.getAttribute('aria-describedby');
  return (id && document.getElementById(id)?.textContent) || '';
}

describe('the metadata editor page names the read-only cause to the scoped inspector (objectstack#29079)', () => {
  it('a writable flow: the node inspector is editable and carries no reason', async () => {
    await openAndSelect('flow', 'close_case');
    expect(await nodeInspectorReason()).toBeNull();
    expect(screen.getByRole('button', { name: t('engine.inspector.flowNode.remove', 'en-US') })).toBeEnabled();
  });

  it("a read-only package's area: the package is the reason, as Studio's Automations pillar says it", async () => {
    await openAndSelect('flow', 'close_case', READ_ONLY_HOST);
    expect(await nodeInspectorReason()).toBe(t('engine.studio.pkg.readonlyHint', 'en-US'));
  });

  it('a caller without manage_metadata: the capability is the reason', async () => {
    canAuthor = false;
    await openAndSelect('flow', 'close_case');
    expect(await nodeInspectorReason()).toBe(t('engine.edit.capabilityReadOnly', 'en-US'));
  });

  it('a locked item: the lock and its served reason are the reason', async () => {
    layered = {
      effective: FLOW,
      code: null,
      overlay: null,
      editable: false,
      deletable: false,
      lock: 'full',
      lockReason: 'Managed by the release pipeline.',
    };
    await openAndSelect('flow', 'close_case');
    expect(await nodeInspectorReason()).toBe(
      `${t('engine.edit.lockFull', 'en-US')} Managed by the release pipeline.`,
    );
  });

  it('a flow a code package ships: the package is the reason, with the way to author one', async () => {
    layered = {
      effective: FLOW,
      code: { ...FLOW, _packageId: 'com.vendor.hr' },
      overlay: null,
      provenance: 'package',
      packageId: 'com.vendor.hr',
      editable: true,
      deletable: false,
    };
    await openAndSelect('flow', 'close_case');
    expect(await nodeInspectorReason()).toBe(
      tFormat('engine.edit.artifactLockedBanner', 'en-US', { type: 'flow' }),
    );
  });

  it("the walled security catalog: the wall is the reason, handed to a host's inspector", async () => {
    walled = true;
    layered = { effective: POSITION, code: null, overlay: null, editable: true, deletable: true };
    await openAndSelect('position', 'sales_rep');
    const inspector = await screen.findByTestId('host-position-inspector');
    expect(inspector).toHaveAttribute('data-readonly', 'true');
    await waitFor(() =>
      expect(inspector).toHaveTextContent(
        tFormat('engine.catalog.readOnly.walled', 'en-US', { type: 'Position' }),
      ),
    );
  });
});

/** A full lock with a served reason, over `effective`. */
function lockedEnvelope(effective: Record<string, unknown>) {
  return {
    effective,
    code: null,
    overlay: null,
    editable: false,
    deletable: false,
    lock: 'full',
    lockReason: 'Managed by the release pipeline.',
  };
}

const LOCK_REASON = () => `${t('engine.edit.lockFull', 'en-US')} Managed by the release pipeline.`;

/** Open the item and leave the canvas unselected: the page's own panel shows. */
async function openUnselected(type: string, name: string) {
  render(
    <MemoryRouter initialEntries={[`/apps/setup/metadata/${type}/${name}`]}>
      <MetadataResourceEditPage type={type} name={name} />
    </MemoryRouter>,
  );
  await screen.findByRole('button', { name: 'select on canvas' });
}

/** The Properties panel's form controls: the ones the reason is about. */
const panelControls = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('input, select, textarea, button[role="combobox"], button[role="switch"]')];

/** Tab from the top of the page until `target` has focus, or the page runs out. */
async function tabTo(user: ReturnType<typeof userEvent.setup>, target: HTMLElement): Promise<boolean> {
  for (let i = 0; i < 80 && document.activeElement !== target; i++) await user.tab();
  return document.activeElement === target;
}

describe('the panel shown with nothing selected names the read-only cause too (objectstack#29897)', () => {
  it.each([
    ['object', 'task', OBJECT],
    ['flow', 'close_case', FLOW],
  ] as const)(
    'a locked %s: the Properties panel is a described tab stop holding its disabled controls',
    async (type, name, effective) => {
      layered = lockedEnvelope(effective);
      await openUnselected(type, name);
      const panel = await screen.findByTestId('metadata-properties-readonly-reason');
      expect(panel).toHaveAttribute('tabindex', '0');
      expect(panel).toHaveAccessibleName(t('engine.edit.inspector.properties', 'en-US'));
      expect(panel).toHaveAccessibleDescription(LOCK_REASON());

      const controls = panelControls(panel);
      // A vacuous pass over an empty panel is not one.
      expect(controls.length).toBeGreaterThanOrEqual(1);
      for (const el of controls) expect(el).toBeDisabled();
    },
  );

  it.each([
    ['object', 'task', OBJECT],
    ['flow', 'close_case', FLOW],
  ] as const)(
    'a locked %s: hovering a disabled control, or tabbing to the panel, opens the reason',
    async (type, name, effective) => {
      const user = userEvent.setup();
      layered = lockedEnvelope(effective);
      await openUnselected(type, name);
      const panel = await screen.findByTestId('metadata-properties-readonly-reason');

      const [control] = panelControls(panel);
      expect(control).toBeDisabled();
      await user.hover(control);
      expect(await screen.findByRole('tooltip')).toHaveTextContent(LOCK_REASON());
      await user.unhover(control);
      await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());

      expect(await tabTo(user, panel)).toBe(true);
      expect(await screen.findByRole('tooltip')).toHaveTextContent(LOCK_REASON());
    },
  );

  it('a writable object: the Properties panel is live and carries no reason', async () => {
    layered = { effective: OBJECT, code: null, overlay: null, editable: true, deletable: true };
    await openUnselected('object', 'task');
    const label = await screen.findByDisplayValue('Task');
    await waitFor(() => expect(label).toBeEnabled());
    expect(screen.queryByTestId('metadata-properties-readonly-reason')).toBeNull();
    expect(screen.queryByText(LOCK_REASON())).toBeNull();
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29376 — a writable package's flow definition switch keeps
 * keyboard focus across a flip.
 *
 * Measured live in Chromium 153 on a fresh showcase: a scratch writable
 * package with one flow, its definition switch focused, Space; the draft save
 * answered 200 and `document.activeElement` was the page body afterwards. The
 * switch drew `disabled` while the save was in flight, and a browser moves
 * focus off a focused control that turns disabled and never hands it back.
 * In flight it is now `aria-disabled` and refuses the press in its handler.
 *
 * Pinned here:
 *  - a keyboard flip, saved or refused, leaves focus on the switch while the
 *    save is in flight and after it lands, and a second Space in flight sends
 *    no second save;
 *  - a read-only package's switch is unchanged: `disabled`, no
 *    `aria-disabled`, described by the package's reason, not focusable.
 *
 * The harness is `StudioDesignSurface.automationsReadOnly-11124`'s: the REAL
 * registered `FlowPreview` and `FlowInspector`, and a client double whose
 * draft save can be held on a gate and refused.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.app';

const NODES = [
  { id: 'start', type: 'start', label: 'Start' },
  { id: 'end', type: 'end', label: 'End' },
];
const EDGES = [{ id: 'e1', source: 'start', target: 'end' }];
const FLOW = { name: 'notify_owner', label: 'Notify owner', type: 'autolaunched', status: 'active', nodes: NODES, edges: EDGES };

const LOCKED_MESSAGE = 'flow/notify_owner belongs to a read-only package and cannot be changed.';

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  saves: [] as Array<{ type: string; name: string; body: Record<string, unknown> }>,
  /** When set, a draft save waits on this gate before it answers. */
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

beforeEach(() => {
  server.active.clear();
  server.saves.length = 0;
  server.gate = null;
  server.refuse = false;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  server.active.set(`flow/${FLOW.name}`, JSON.parse(JSON.stringify(FLOW)));
});

afterEach(cleanup);

function renderPillar(readOnly: boolean) {
  return render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
      <AutomationsPillar packageId={PKG} readOnly={readOnly} />
    </MemoryRouter>,
  );
}

/** The canvas's own status pill, which reads the same `draft.status` as the switch. */
function canvasStatus(): string {
  return screen.getByText('Status:').nextElementSibling?.textContent ?? '';
}
const STATUS_ON = t('engine.studio.auto.enabled', 'en');

async function openFlow(): Promise<HTMLElement> {
  await waitFor(() => expect(canvasStatus()).toBe(STATUS_ON), { timeout: 8000 });
  return screen.getByRole('switch');
}

const READ_ONLY_REASON = 'Read-only package — switch to or create a writable package to edit.';

// A browser runs the HTML focus fixup: a focused control that turns `disabled`
// drops focus to the body (measured in Chromium 153, and not handed back when
// it is enabled again). happy-dom keeps focus on it, so the test runs the
// fixup on the switch the way the browser does, else the focus pins could not
// fail. (happy-dom's `blur()` does nothing on a disabled control, so focus is
// moved to the body itself.)
function runFocusFixup(el: HTMLElement): () => void {
  const observer = new MutationObserver(() => {
    if (el.hasAttribute('disabled') && document.activeElement === el) document.body.focus();
  });
  observer.observe(el, { attributes: true, attributeFilter: ['disabled'] });
  return () => observer.disconnect();
}

describe('Automations — the flow definition switch keeps keyboard focus across a flip (objectstack#29376)', () => {
  it.each([
    ['saved', false],
    ['refused', true],
  ])('a keyboard flip that is %s leaves focus on the switch, and a second Space in flight sends nothing', async (_answer, refuse) => {
    server.refuse = refuse;
    let release!: () => void;
    server.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const user = userEvent.setup();
    renderPillar(false);
    const sw = await openFlow();
    const stopFixup = runFocusFixup(sw);
    sw.focus();
    expect(document.activeElement).toBe(sw);

    await user.keyboard(' ');
    await waitFor(() => expect(server.saves).toHaveLength(1), { timeout: 8000 });
    expect(server.saves[0]!.body.status).toBe('obsolete');
    await waitFor(() => expect(sw).toHaveAttribute('aria-disabled', 'true'));
    // In flight: still focused, refused to a press, still focusable.
    expect(document.activeElement).toBe(sw);
    expect(sw).toBeEnabled();
    // The second press is refused. Draft saves run one at a time
    // (`useDraftSaveGuard`'s queue), so a second save would wait behind the
    // held one and the server count alone cannot see it in flight: the switch
    // still showing the first flip can, and the count after release does.
    await user.keyboard(' ');
    await new Promise((r) => setTimeout(r, 50));
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(server.saves).toHaveLength(1);

    release();
    await waitFor(() => expect(sw).not.toHaveAttribute('aria-disabled'), { timeout: 8000 });
    if (refuse) {
      await screen.findByText(LOCKED_MESSAGE, undefined, { timeout: 8000 });
      await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'), { timeout: 8000 });
    } else {
      expect(sw).toHaveAttribute('aria-checked', 'false');
    }
    // The answer landed on the same switch, and focus is still on it.
    expect(screen.getByRole('switch')).toBe(sw);
    expect(document.activeElement).toBe(sw);
    await new Promise((r) => setTimeout(r, 50));
    expect(server.saves).toHaveLength(1);
    stopFixup();
  });

  it('a read-only package’s switch stays disabled, out of the tab order, and described by its reason', async () => {
    renderPillar(true);
    const sw = await openFlow();
    expect(sw).toBeDisabled();
    expect(sw).not.toHaveAttribute('aria-disabled');
    expect(document.getElementById(sw.getAttribute('aria-describedby') ?? '')).toHaveTextContent(READ_ONLY_REASON);
    sw.focus();
    expect(document.activeElement).not.toBe(sw);
  });
});

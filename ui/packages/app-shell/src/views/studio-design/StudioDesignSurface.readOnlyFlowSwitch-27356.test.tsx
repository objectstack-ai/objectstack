// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27356 (hotcrm#2320 Studio S10) — a read-only package's flow
 * "Enabled" switch is not drawn like a live control. It was already disabled
 * (objectui#11124), yet its track stayed green, so it read as a switch the
 * author could flip. On a read-only package the track is muted and a lock sits
 * beside the word; the thumb, the word and `aria-checked` still say on or off.
 * A writable package's switch keeps the green track and no lock (the control).
 *
 * The canvas is the REAL registered `FlowPreview`; the client is a server
 * double, as in the objectui#11124 file this harness is copied from.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.app';

const NODES = [
  { id: 'start', type: 'start', label: 'Start' },
  { id: 'end', type: 'end', label: 'End' },
];
const EDGES = [{ id: 'e1', source: 'start', target: 'end' }];
const FLOW = { name: 'notify_owner', label: 'Notify owner', type: 'autolaunched', status: 'active', nodes: NODES, edges: EDGES };

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
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
      throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
    }),
    save: vi.fn(async (type: string, name: string, item: unknown) => {
      server.saves.push({ type, name, body: JSON.parse(JSON.stringify(item)) as Record<string, unknown> });
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

// The pillar's `/automation/_status` probe and the inspector's action-catalog
// read both go through the global `fetch`; one module-scope double answers
// "absent" so each keeps its documented fallback.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

registerMetadataPreview('flow', FlowPreview);

const key = (type: string, name: string) => `${type}/${name}`;

beforeEach(() => {
  server.active.clear();
  server.saves.length = 0;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
});

afterEach(cleanup);

function renderPillar(readOnly: boolean, status: 'active' | 'obsolete') {
  server.active.set(key('flow', FLOW.name), { ...JSON.parse(JSON.stringify(FLOW)), status });
  return render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
      <AutomationsPillar packageId={PKG} readOnly={readOnly} />
    </MemoryRouter>,
  );
}

const STATUS_ON = t('engine.studio.auto.enabled', 'en');
const STATUS_OFF = t('engine.studio.auto.disabled', 'en');

/** The switch, once the open flow's document is in (it is not offered before). */
async function openSwitch(word: string): Promise<HTMLElement> {
  return waitFor(
    () => {
      const toggle = screen.getByRole('switch');
      expect(toggle).toHaveTextContent(word);
      return toggle;
    },
    { timeout: 8000 },
  );
}

/** The switch's track: its first child, the pill the thumb slides in. */
const trackOf = (toggle: HTMLElement) => toggle.firstElementChild as HTMLElement;
const thumbOf = (toggle: HTMLElement) => trackOf(toggle).firstElementChild as HTMLElement;
const lockOf = (toggle: HTMLElement) => toggle.querySelector('svg.lucide-lock');

describe('A read-only package draws the flow switch muted, with a lock (objectstack#27356)', () => {
  it('an enabled flow: no green track, a lock, and still on', async () => {
    renderPillar(true, 'active');
    const toggle = await openSwitch(STATUS_ON);

    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(trackOf(toggle).className).not.toContain('bg-emerald-500');
    expect(trackOf(toggle).className).toContain('bg-muted-foreground/60');
    expect(thumbOf(toggle).className).toContain('translate-x-[18px]');
    expect(lockOf(toggle)).not.toBeNull();
    expect(lockOf(toggle)).toHaveAttribute('aria-hidden', 'true');
    // Not a live control: no hover fill.
    expect(toggle.className).not.toContain('hover:bg-muted');

    fireEvent.click(toggle);
    await new Promise((r) => setTimeout(r, 50));
    expect(server.saves).toHaveLength(0);
  });

  it('a disabled flow: the same lock, a fainter track and the thumb at off', async () => {
    renderPillar(true, 'obsolete');
    const toggle = await openSwitch(STATUS_OFF);

    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(trackOf(toggle).className).toContain('bg-muted-foreground/25');
    expect(thumbOf(toggle).className).toContain('translate-x-0.5');
    expect(lockOf(toggle)).not.toBeNull();
  });
});

describe('A writable package keeps the live switch — the control (objectstack#27356)', () => {
  it('an enabled flow: green track, no lock, operable', async () => {
    renderPillar(false, 'active');
    const toggle = await openSwitch(STATUS_ON);

    expect(toggle).toBeEnabled();
    expect(trackOf(toggle).className).toContain('bg-emerald-500');
    expect(lockOf(toggle)).toBeNull();
    expect(toggle.className).toContain('hover:bg-muted');

    fireEvent.click(toggle);
    await waitFor(() => expect(server.saves).toHaveLength(1), { timeout: 8000 });
    expect(server.saves[0]!.body.status).toBe('obsolete');
  });

  it('a disabled flow: the grey track it always had, no lock', async () => {
    renderPillar(false, 'obsolete');
    const toggle = await openSwitch(STATUS_OFF);

    expect(trackOf(toggle).className).toContain('bg-muted-foreground/40');
    expect(lockOf(toggle)).toBeNull();
  });
});

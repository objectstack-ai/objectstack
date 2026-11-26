// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11553 — a package-less flow (a clone of a packaged flow, which
 * ADR-0126 §7.1 makes "an ordinary org/install-owned flow") is reachable in
 * Studio, editable, and its deep link opens it and no other flow.
 *
 * Measured on objectstack 17.6.0 with the console at the pin: the clone's row
 * names no package; the package-scoped flow list omits it and the bare list
 * includes it; Studio's every route was keyed by a package, its Automations
 * rail read the package-scoped list, and a deep link naming the clone as the
 * surface opened the package's first flow instead.
 *
 * Rendered through the REAL `StudioDesignSurface` on the REAL route shape, with
 * the real registered `FlowPreview` / `FlowInspector`, so "opens editable" is
 * what the canvas and the switch actually offer. The server double answers the
 * metadata reads the way the platform does: a `packageId` list keeps only rows
 * whose `_packageId` equals it, and the unscoped list returns every row. Each
 * package-less case has its packaged control (the read-only package below
 * stays read-only, as objectui#11124 pins at the pillar).
 *
 * objectstack#36903 — the scope's flows live in its own leg of the "All
 * metadata" area: the list at `/studio/~org/metadata/flow?source=runtime`, a
 * flow full-screen at `/studio/~org/metadata/flow/<name>?source=runtime`; the
 * old `/studio/~org/automations` addresses redirect there.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

const SHOWCASE = 'com.example.showcase';
/** objectstack#36903 — the showcase's paired customization package, listed only where a case says so. */
const PAIR = 'com.example.showcase.custom';
const NODES = [
  { id: 'start', type: 'start', label: 'Start' },
  { id: 'end', type: 'end', label: 'End' },
];
const EDGES = [{ id: 'e1', source: 'start', target: 'end' }];
const flow = (name: string, label: string, packageId?: string) => ({
  name,
  label,
  type: 'autolaunched',
  status: 'active',
  nodes: NODES,
  edges: EDGES,
  ...(packageId ? { _packageId: packageId } : {}),
});

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  drafts: [] as Array<{ type: string; name: string; packageId: string | null }>,
  saves: [] as Array<{ type: string; name: string; options: Record<string, unknown> | undefined; body: Record<string, unknown> }>,
  publishedByRef: [] as Array<{ type: string; name: string }>,
  packageBatches: [] as string[],
}));

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async (type: string, options?: { packageId?: string }) =>
    [...server.active.values()]
      .filter((row) => row.__type === type)
      .filter((row) => !options?.packageId || row._packageId === options.packageId)
      .map(({ __type: _t, ...row }) => row),
  ),
  listDrafts: vi.fn(async (options: { packageId?: string; type?: string } = {}) =>
    server.drafts.filter(
      (d) => (!options.type || d.type === options.type) && (!options.packageId || d.packageId === options.packageId),
    ),
  ),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    const row = server.active.get(`${type}/${name}`);
    const { __type: _t, ...eff } = row ?? {};
    return { code: null, overlay: row ? eff : null, overlayScope: row ? 'env' : null, effective: row ? eff : null };
  }),
  getDraft: vi.fn(async (type: string, name: string) => {
    throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
  }),
  save: vi.fn(async (type: string, name: string, item: unknown, options?: Record<string, unknown>) => {
    server.saves.push({ type, name, options, body: JSON.parse(JSON.stringify(item)) as Record<string, unknown> });
    return { type, name, item };
  }),
  publishDraft: vi.fn(async (type: string, name: string) => {
    server.publishedByRef.push({ type, name });
    return { success: true };
  }),
  publishPackageDrafts: vi.fn(async (packageId: string) => {
    server.packageBatches.push(packageId);
    return { success: true, failed: [] };
  }),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
}));

/** Whether the package list serves the showcase's pair (objectstack#36903, the pair's bookmarks). */
const listing = vi.hoisted(() => ({ pair: false }));

/** What the surface handed the pending-changes sheet, last render. */
const panel = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
/** Read through a call, so a reset between renders does not narrow it away. */
const panelProps = (): Record<string, unknown> | null => panel.props;
const chatDock = vi.hoisted(() => ({ mounts: 0 }));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return {
    ...mod,
    // The stock showcase: its one installed package is read-only.
    fetchPackages: vi.fn(async () => [{ id: SHOWCASE, name: 'Showcase', writable: false, namespace: 'showcase' }]),
    // objectstack#36903 — the same answer as the area reads it: a flow opens
    // in the area now, whose courtesy gate reads the listed manifests.
    fetchListedPackageManifests: vi.fn(
      async () =>
        new Map([
          [SHOWCASE, { id: SHOWCASE, name: 'Showcase', writable: false, manifest: { scope: 'installed', version: '1.0.0' } }],
          ...(listing.pair
            ? [[PAIR, { id: PAIR, name: 'Showcase customizations', writable: true, manifest: { namespace: 'showcase_custom' } }] as const]
            : []),
        ]),
    ),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

vi.mock('./StudioAiCopilot', () => ({
  StudioChatDock: () => {
    chatDock.mounts += 1;
    return null;
  },
}));

vi.mock('../../preview/DraftChangesPanel', async () => {
  const { createElement } = await import('react');
  const { useSurfaceNavigator } = await import('./surfaceDeepLinkChannel');
  return {
    DraftChangesPanel: (props: Record<string, unknown>) => {
      panel.props = props;
      // objectstack#36903 — an entry asks the host to open the flow a draft names.
      const openSurface = useSurfaceNavigator();
      return createElement(
        'button',
        { type: 'button', onClick: () => openSurface?.({ type: 'flow', name: 'qa_urgent_alert_clone' }) },
        'Pending flow/qa_urgent_alert_clone',
      );
    },
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

// The console's preview and authoring code loads `@objectstack/lint` lazily;
// warmed here so its first load is paid at import, not inside a test's clock.
import '@objectstack/lint';
import { StudioDesignSurface } from './StudioDesignSurface';
import { StudioPillarRedirect } from './StudioPillarRedirect';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { getMetadataPreview, registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { FlowPreview } from '../metadata-admin/previews/FlowPreview';
import { FlowInspector } from '../metadata-admin/inspectors/FlowInspector';
import { t } from '../metadata-admin/i18n';
// The source under test reaches these dynamic imports (the command palette's
// record preview, the drafts panel's lint, the code editor): their first load
// is paid here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@object-ui/plugin-detail';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

// The two global-`fetch` reads on this surface: the pending-drafts feed
// (`/meta/_drafts`, the header count and the package-less publish) and the
// rail's `/automation/_status` probe (answered "absent", so no dots).
vi.stubGlobal(
  'fetch',
  vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.startsWith('/api/v1/meta/_drafts')) {
      const qs = new URL(url, 'http://x').searchParams.get('package');
      const drafts = server.drafts.filter((d) => !qs || d.packageId === qs);
      return new Response(JSON.stringify({ drafts }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('null', { status: 404, headers: { 'content-type': 'application/json' } });
  }),
);

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

registerMetadataPreview('flow', FlowPreview);
registerMetadataInspector('flow', FlowInspector);

function seed(row: Record<string, unknown>) {
  server.active.set(`flow/${String(row.name)}`, { __type: 'flow', ...row });
}

beforeEach(() => {
  server.active.clear();
  server.drafts.length = 0;
  server.saves.length = 0;
  server.publishedByRef.length = 0;
  server.packageBatches.length = 0;
  panel.props = null;
  chatDock.mounts = 0;
  listing.pair = false;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  // Two packaged flows on the read-only showcase, and the clone, which names no package.
  seed(flow('showcase_urgent_task_alert', 'Urgent task alert', SHOWCASE));
  seed(flow('showcase_daily_digest', 'Daily digest', SHOWCASE));
  seed(flow('qa_urgent_alert_clone', 'QA urgent alert clone'));
});

afterEach(cleanup);

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{`${pathname}${search}`}</div>;
}

/** A route change into the package-less scope, the surface left mounted. */
function OrgScopeDoor() {
  const navigate = useNavigate();
  return <button type="button" aria-label="test door: package-less scope" data-testid="org-scope-door" onClick={() => navigate(ORG_CLONE)} />;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <LocationProbe />
      <OrgScopeDoor />
      <Routes>
        <Route path="/studio/:packageId/metadata/*" element={<StudioDesignSurface area="metadata" />} />
        <Route path="/studio/:packageId/:tab" element={<StudioPillarRedirect><StudioDesignSurface /></StudioPillarRedirect>} />
      </Routes>
    </MemoryRouter>,
  );
}

const location = () => screen.getByTestId('location').textContent ?? '';

/** objectstack#36903 — the scope's list and the clone's designer, on the scope's leg of the area. */
const ORG_LIST = '/studio/~org/metadata/flow?source=runtime';
const ORG_CLONE = '/studio/~org/metadata/flow/qa_urgent_alert_clone?source=runtime';

/**
 * The canvas's own status pill. With the `_status` probe answered "absent" it
 * reads the open flow's `draft.status`, in the switch's words (objectui#11779).
 */
function canvasStatus(): string {
  return screen.getByText('Status:').nextElementSibling?.textContent ?? '';
}

async function openedFlow(name: string): Promise<void> {
  await screen.findByTitle(`API name: ${name}`, undefined, { timeout: 8000 });
  await waitFor(() => expect(canvasStatus()).toBe(t('engine.studio.auto.enabled', 'en')), { timeout: 8000 });
}

describe('the package-less scope lists a package-less flow and opens it editable (objectui#11553)', () => {
  it('opens the clone on its address, read unscoped: a package-scoped read cannot see a package-less row', async () => {
    renderAt(ORG_CLONE);
    await openedFlow('qa_urgent_alert_clone');

    expect(mockClient.list).toHaveBeenCalledWith('flow');
    expect(mockClient.list).not.toHaveBeenCalledWith('flow', expect.objectContaining({ packageId: expect.anything() }));
  });

  it('the old scope address lands on the scope\'s flow list', async () => {
    renderAt('/studio/~org/automations');
    await waitFor(() => expect(location()).toBe(ORG_LIST), { timeout: 8000 });
  });

  it('its flow list names its flows and offers no create: authoring stays package-first', async () => {
    renderAt(ORG_LIST);
    // Positive leg: the list rendered, with the scope's flow on it.
    expect(await screen.findByText('qa_urgent_alert_clone', {}, { timeout: 8000 })).toBeInTheDocument();
    // objectstack#36903 — the rail's New went to the list's create, which the
    // scope's read-only area does not offer.
    expect(screen.queryByRole('button', { name: /^(New|Create)$/ })).not.toBeInTheDocument();
    expect(screen.queryByTitle('New automation')).not.toBeInTheDocument();
    // A list with a flow on it says nothing of the empty scope's guidance.
    expect(document.body.textContent).not.toContain(t('engine.studio.org.none', 'en'));
  });

  // objectstack#36903 — the empty scope's list keeps its pillar's guidance
  // (ADR-0146 D11): a packaged flow is changed in its package, with New similar.
  it('its empty flow list says how a packaged flow is changed instead', async () => {
    server.active.delete('flow/qa_urgent_alert_clone');
    renderAt(ORG_LIST);
    expect(await screen.findByText(t('engine.studio.org.none', 'en'), {}, { timeout: 8000 })).toBeInTheDocument();
    // It reads as an empty list, not as a search that matched nothing.
    expect(screen.queryByText(/No matches for/)).toBeNull();
  });

  it('opens it editable, and an edit saves a draft bound to no package', async () => {
    renderAt(ORG_CLONE);
    await openedFlow('qa_urgent_alert_clone');

    const toggle = screen.getByRole('switch');
    expect(toggle).toBeEnabled();
    expect(screen.getAllByRole('button', { name: 'Add connected node' }).length).toBeGreaterThan(0);

    fireEvent.click(toggle);
    await waitFor(() => expect(server.saves).toHaveLength(1), { timeout: 8000 });
    const [saved] = server.saves;
    expect(saved!.name).toBe('qa_urgent_alert_clone');
    expect(saved!.body.status).toBe('obsolete');
    expect(saved!.options?.mode).toBe('draft');
    expect(saved!.options?.packageId).toBeUndefined();
  });

  it('offers its one page, no Create app, no package copilot, and names the scope beside 「‹ Back to app」', async () => {
    renderAt(ORG_CLONE);
    await openedFlow('qa_urgent_alert_clone');

    // objectstack#36899 — the left menu: the scope's flows are its current
    // entry; no package pillar, area or Interfaces page is offered.
    const menu = within(screen.getByTestId('studio-menu'));
    const flows = menu.getByTestId('studio-menu-entry-orgFlows');
    expect(flows).toHaveAttribute('href', ORG_LIST);
    expect(flows).toHaveAttribute('aria-current', 'page');
    for (const a of menu.getAllByRole('link')) {
      expect(a.getAttribute('href')).not.toMatch(/^\/studio\/~org\/(data|access|interfaces|automations)/);
      expect(a.getAttribute('href')).not.toMatch(/^\/studio\/~org\/metadata\/(?!flow)/);
    }
    expect(menu.queryByTestId('studio-menu-entry-owd')).toBeNull();
    expect(menu.queryByTestId('studio-menu-entry-diagnostics')).toBeNull();
    expect(screen.queryByRole('button', { name: /Create app/ })).not.toBeInTheDocument();
    expect(chatDock.mounts).toBe(0);
    // objectstack#36501, decision 5 (objectstack#36899) — no app owns the
    // scope, so the name slot names the scope, as for a package with no app.
    expect(screen.getByTestId('studio-back')).toHaveTextContent(/^Back to app·Organization flows·App Studio$/);
    // No "New" flow here: authoring stays package-first.
    expect(screen.queryByTitle('New automation')).not.toBeInTheDocument();
  });

  it('a package-less scope URL on another pillar lands on its flow list', async () => {
    renderAt('/studio/~org/data');
    await waitFor(() => expect(location()).toBe(ORG_LIST), { timeout: 8000 });
  });
});

describe('the deep link to a package-less flow opens that flow, not another (objectui#11553)', () => {
  it('in the package-less scope: the named flow, though another is listed first', async () => {
    seed(flow('aa_first_org_flow', 'AA first org flow'));
    renderAt('/studio/~org/automations?surface=flow%3Aqa_urgent_alert_clone');

    await openedFlow('qa_urgent_alert_clone');
    expect(screen.queryByTitle('API name: aa_first_org_flow')).not.toBeInTheDocument();
    expect(location()).toBe(ORG_CLONE);
  });

  it('the measured link, through the showcase pillar: lands on the package-less scope, the clone open and editable', async () => {
    renderAt(`/studio/${SHOWCASE}/automations?surface=flow%3Aqa_urgent_alert_clone`);

    await waitFor(() => expect(location()).toBe(ORG_CLONE), { timeout: 8000 });
    await openedFlow('qa_urgent_alert_clone');
    expect(screen.getByRole('switch')).toBeEnabled();
    // The defect's own signature: the package's first flow was opened instead.
    expect(mockClient.layered).not.toHaveBeenCalledWith('flow', 'showcase_urgent_task_alert');
  });

  it('a link naming a flow nowhere held opens no other flow, and says so', async () => {
    renderAt(`/studio/${SHOWCASE}/automations?surface=flow%3Anobody_has_this`);

    await screen.findByText('The link names flow “nobody_has_this”, which is not here.', undefined, { timeout: 8000 });
    expect(location()).toBe(`/studio/${SHOWCASE}/metadata/flow/nobody_has_this?package=${SHOWCASE}`);
    expect(mockClient.layered).not.toHaveBeenCalled();
  });
});

describe('the packaged control: a read-only package stays read-only (objectui#11124)', () => {
  it('opens the package’s flow and offers no edit', async () => {
    renderAt(`/studio/${SHOWCASE}/metadata/flow/showcase_urgent_task_alert`);
    await openedFlow('showcase_urgent_task_alert');

    await waitFor(() => expect(screen.getByRole('switch')).toBeDisabled());
    expect(screen.queryAllByRole('button', { name: 'Add connected node' })).toHaveLength(0);
  });

  it('from that read-only package, a switch into the package-less scope opens it editable', async () => {
    // The surface stays mounted across the switch, so the read-only answer the
    // showcase got is still in hand when the package-less scope renders. The
    // switch used to be the package switcher's entry, removed by
    // objectstack#36501; the route change is the same without it.
    renderAt(`/studio/${SHOWCASE}/metadata/flow/showcase_urgent_task_alert`);
    await openedFlow('showcase_urgent_task_alert');
    await waitFor(() => expect(screen.getByRole('switch')).toBeDisabled());

    fireEvent.click(screen.getByTestId('org-scope-door'));

    await waitFor(() => expect(location()).toBe(ORG_CLONE));
    await openedFlow('qa_urgent_alert_clone');
    expect(screen.getByRole('switch')).toBeEnabled();
  });
});

describe('the package-less scope reviews and publishes exactly its own drafts (objectui#11553)', () => {
  // objectstack#36903 — the sheet's flow request lands on the scope's own address.
  it('a Pending changes request for a scope flow opens it on the scope’s address', async () => {
    renderAt(ORG_LIST);
    expect(await screen.findByText('qa_urgent_alert_clone', {}, { timeout: 8000 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pending flow/qa_urgent_alert_clone' }));
    await waitFor(() => expect(location()).toBe(ORG_CLONE), { timeout: 8000 });
    await openedFlow('qa_urgent_alert_clone');
  });

  beforeEach(() => {
    server.drafts.push(
      { type: 'flow', name: 'qa_urgent_alert_clone', packageId: null },
      { type: 'object', name: 'org_loose_object', packageId: null },
      { type: 'flow', name: 'showcase_daily_digest', packageId: SHOWCASE },
    );
  });

  it('counts only package-less flow drafts', async () => {
    renderAt(ORG_CLONE);
    await openedFlow('qa_urgent_alert_clone');
    await waitFor(() => expect(screen.getByRole('button', { name: /Changes · 1$/ })).toBeInTheDocument());
  });

  it('hands the sheet a filter that keeps only package-less flow drafts', async () => {
    renderAt(ORG_CLONE);
    await openedFlow('qa_urgent_alert_clone');

    const include = panelProps()?.include as ((e: { type: string; name: string; packageId: string | null }) => boolean) | undefined;
    expect(include).toBeTypeOf('function');
    expect(server.drafts.filter((d) => include!(d)).map((d) => d.name)).toEqual(['qa_urgent_alert_clone']);
    // Control: a package's sheet is not narrowed.
    cleanup();
    panel.props = null;
    renderAt(`/studio/${SHOWCASE}/metadata/flow/showcase_urgent_task_alert`);
    await openedFlow('showcase_urgent_task_alert');
    expect(panelProps()?.include).toBeUndefined();
  });

  it('publishes each package-less flow draft by reference, and nothing through the package batch door', async () => {
    renderAt(ORG_CLONE);
    await openedFlow('qa_urgent_alert_clone');

    const onPublish = panelProps()?.onPublish as (() => Promise<void>) | undefined;
    expect(onPublish).toBeTypeOf('function');
    await onPublish!();

    expect(server.publishedByRef).toEqual([{ type: 'flow', name: 'qa_urgent_alert_clone' }]);
    expect(server.packageBatches).toEqual([]);
  });
});

/**
 * objectui#11591 — the "no designers" notice keys on the designer registry,
 * never on the absence of an open flow. On a deep-link miss and on an empty
 * list no flow is open, and the canvas chip used to read the registry for the
 * OPEN flow's type — none — so it said "No metadata designers are registered
 * in this session…" on a page whose designers are registered (this file
 * registers `FlowPreview` / `FlowInspector` above, and the controls below read
 * the registry back). That the notice still shows when the registry really is
 * empty, open flow or none, is pinned beside its other sites, in
 * `StudioDesignSurface.designerRegistryMissing.test.tsx`.
 */
describe('a deep-link miss and an empty list show no "no designers" notice (objectui#11591)', () => {
  const NO_DESIGNERS = 'No metadata designers are registered';

  it('the measured miss: the package-less page, a link naming a packaged flow', async () => {
    renderAt('/studio/~org/automations?surface=flow%3Ashowcase_urgent_task_alert');

    await screen.findByText('The link names flow “showcase_urgent_task_alert”, which is not here.', undefined, {
      timeout: 8000,
    });
    // Control: the designers are registered, so the notice would be false.
    expect(getMetadataPreview('flow')).toBe(FlowPreview);
    expect(document.body.textContent).not.toContain(NO_DESIGNERS);
    expect(screen.getByText('Visual orchestration · click a node to configure')).toBeInTheDocument();
    // No flow was opened in the missing one's place.
    expect(mockClient.layered).not.toHaveBeenCalled();
  });

  it('a package page’s miss, too', async () => {
    renderAt(`/studio/${SHOWCASE}/automations?surface=flow%3Anobody_has_this`);

    await screen.findByText('The link names flow “nobody_has_this”, which is not here.', undefined, { timeout: 8000 });
    expect(getMetadataPreview('flow')).toBe(FlowPreview);
    expect(document.body.textContent).not.toContain(NO_DESIGNERS);
  });

  it('an empty scope lands on its list — no miss, no "no designers" notice, no flow read', async () => {
    server.active.delete('flow/qa_urgent_alert_clone');
    renderAt('/studio/~org/automations');

    await waitFor(() => expect(location()).toBe(ORG_LIST), { timeout: 8000 });
    expect(document.body.textContent).not.toContain(NO_DESIGNERS);
    expect(document.body.textContent).not.toContain('The link names flow');
    expect(mockClient.layered).not.toHaveBeenCalled();
  });

  it('control: an open flow on the same page reads the same chip', async () => {
    renderAt(ORG_CLONE);
    await openedFlow('qa_urgent_alert_clone');

    expect(screen.getByText('Visual orchestration · click a node to configure')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(NO_DESIGNERS);
  });
});

/**
 * objectstack#36903 — the retired Automations pillar's bookmarks, opened
 * through the REAL surface: each lands on the flow's own address with the
 * designer open on that flow. A read-only base's pair-added flow opens at the
 * base's address, writable at the pair (the designer reads the pair's flows
 * with the base's); the pair's own old address — where New similar sent the
 * author before this card — lands on the pair's own area.
 */
describe('an old Automations bookmark lands on the flow’s address, the designer open on it (objectstack#36903)', () => {
  const pairChip = () => screen.queryByTestId('studio-pair-item-chip');

  it('a package’s flow: its address on the package, the designer open read-only', async () => {
    renderAt(`/studio/${SHOWCASE}/automations?surface=flow%3Ashowcase_daily_digest`);

    await waitFor(() => expect(location()).toBe(`/studio/${SHOWCASE}/metadata/flow/showcase_daily_digest?package=${SHOWCASE}`), {
      timeout: 8000,
    });
    await openedFlow('showcase_daily_digest');
    await waitFor(() => expect(screen.getByRole('switch')).toBeDisabled());
    expect(mockClient.layered).not.toHaveBeenCalledWith('flow', 'showcase_urgent_task_alert');
  });

  describe('a read-only base with a pair', () => {
    beforeEach(() => {
      listing.pair = true;
      seed(flow('showcase_alert_copy', 'Alert copy', PAIR));
    });

    it('the base’s old address naming a pair-added flow: the base’s address, open writable, with the pair chip', async () => {
      renderAt(`/studio/${SHOWCASE}/automations?surface=flow%3Ashowcase_alert_copy`);

      await waitFor(() => expect(location()).toBe(`/studio/${SHOWCASE}/metadata/flow/showcase_alert_copy?package=${SHOWCASE}`), {
        timeout: 8000,
      });
      await openedFlow('showcase_alert_copy');
      await waitFor(() => expect(screen.getByRole('switch')).toBeEnabled(), { timeout: 8000 });
      expect(pairChip()).toBeInTheDocument();
    });

    it('the pair’s old address: the pair’s own address, the copy open writable', async () => {
      renderAt(`/studio/${PAIR}/automations?surface=flow%3Ashowcase_alert_copy`);

      await waitFor(() => expect(location().split('?')[0]).toBe(`/studio/${PAIR}/metadata/flow/showcase_alert_copy`), {
        timeout: 8000,
      });
      await openedFlow('showcase_alert_copy');
      await waitFor(() => expect(screen.getByRole('switch')).toBeEnabled(), { timeout: 8000 });
    });

    // CONTROL: with the pair listed, the base's own flow stays read-only on the base.
    it('CONTROL: the base’s own flow, through the same old address, stays read-only and carries no pair chip', async () => {
      renderAt(`/studio/${SHOWCASE}/automations?surface=flow%3Ashowcase_daily_digest`);

      await waitFor(() => expect(location()).toBe(`/studio/${SHOWCASE}/metadata/flow/showcase_daily_digest?package=${SHOWCASE}`), {
        timeout: 8000,
      });
      await openedFlow('showcase_daily_digest');
      await waitFor(() => expect(screen.getByRole('switch')).toBeDisabled());
      expect(pairChip()).toBeNull();
    });
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A pending catalog read says what is loading, and a failed one names its class
 * and offers Retry (objectui#12710).
 *
 * ## The defect
 *
 * Browse Marketplace drew six skeleton cards for as long as the remote catalog
 * read took, about eight seconds on the walk, and nothing said what was
 * loading. A network that drops the request leaves it pending with no answer
 * at all, so the skeleton was the whole page forever. A read that did fail
 * (objectui#11688 made it say why) offered no way to read again but the
 * header's Refresh icon.
 *
 * ## The three states these cases pin
 *
 *   - Loading: the skeleton for at most `SKELETON_MS`, then one line under the
 *     search box; past `SLOW_MS` the line says the catalog is slow to answer
 *     and offers Retry, which issues the same read again.
 *   - Failure: the catalog slot names the class (no server answered, against a
 *     server that answered with a status) and offers Retry; the header's
 *     Installed button stays usable.
 *   - Success: the cards, and a read that settles inside the skeleton's window
 *     never draws the loading line.
 *
 * ## How
 *
 * As in `MarketplacePage.loadFailureCause-11688.test.tsx`, the catalog goes
 * through the REAL `listMarketplacePackages` over a stubbed `fetch`, so the
 * error class is read from what `call()` really throws; only the three side
 * loads are mocked. The clock is faked after the runtime config is read, and
 * every step advances it inside `act`. `findBy*` is not used: its polling
 * runs on the faked clock. `t` echoes «key», with the `status` argument
 * appended, so the chosen string and its status are both seen.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const { navigate, params } = vi.hoisted(() => ({
  navigate: vi.fn(),
  params: { value: {} as { appName?: string } },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useParams: () => params.value,
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      typeof opts?.status === 'number' ? `«${key}:${opts.status}»` : `«${key}»`,
    language: 'en',
  }),
}));

vi.mock('../marketplaceApi', async (importOriginal) => ({
  // `listMarketplacePackages` stays REAL: the class is read from its `call()`.
  ...(await importOriginal<Record<string, unknown>>()),
  listLocalInstalls: async () => [],
  listOrgPackages: async () => ({ connected: false, items: [] }),
  listInstalledPackages: async () => ({ connected: false, items: [] }),
}));

vi.mock('../../../assistant/assistantBus', () => ({ emitMetadataRefresh: () => {} }));

import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePage } from '../MarketplacePage';

const PKG = {
  id: 'pkg_hotcrm',
  manifest_id: 'app.objectstack.hotcrm',
  display_name: 'HotCRM',
  publisher: 'objectstack',
  latest_version: { id: 'ver_hotcrm', version: '1.0.0' },
};

const json = (body: unknown, status = 200, statusText = 'OK') =>
  new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const listed = () => json({ success: true, data: { items: [PKG], total: 1, limit: 100, offset: 0 } });

/** Resolves after `ms` on the (faked) clock. */
const after = (ms: number, answer: () => Response) =>
  new Promise<Response>((resolve) => setTimeout(() => resolve(answer()), ms));

/** The answer to each catalog request, in order; the last one repeats. */
let answers: Array<() => Promise<Response>>;
let catalogCalls = 0;

async function boot() {
  resetRuntimeConfigForTesting();
  catalogCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/api/v1/marketplace/packages')) {
        const answer = answers[Math.min(catalogCalls, answers.length - 1)];
        catalogCalls += 1;
        return answer();
      }
      return json({
        cloudUrl: '',
        singleEnvironment: true,
        features: { installLocal: true, marketplace: true, aiStudio: true, autoPublishAiBuilds: true },
      });
    }),
  );
  await initRuntimeConfig();
  vi.useFakeTimers();
}

/** Advance the faked clock and let React commit what it settled. */
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

const line = () => screen.queryByTestId('marketplace-load-line');
const skeleton = () => screen.queryByTestId('marketplace-skeleton');
const card = () => screen.queryByTestId('marketplace-card-app.objectstack.hotcrm');

beforeEach(() => {
  navigate.mockReset();
  params.value = {};
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('a pending catalog read (objectui#12710)', () => {
  it('(a) a read that answers after 3 s: the skeleton, then the loading line, then the cards', async () => {
    answers = [() => after(3_000, listed)];
    await boot();
    render(<MarketplacePage />);

    await advance(0);
    expect(skeleton()).toBeInTheDocument();
    expect(line()).toBeNull();

    await advance(2_000);
    expect(skeleton()).toBeNull();
    expect(line()).toHaveTextContent('«marketplace.load.loading»');
    expect(screen.queryByTestId('marketplace-load-slow-retry')).toBeNull();

    await advance(1_000);
    expect(card()).toBeInTheDocument();
    expect(line()).toBeNull();
    expect(skeleton()).toBeNull();
  });

  it('(b) a read pending past 10 s says it is slow and offers Retry, which issues one read', async () => {
    let answerFirst: (r: Response) => void = () => {};
    answers = [
      () => new Promise<Response>((resolve) => { answerFirst = resolve; }),
      () => new Promise<Response>(() => {}),
    ];
    await boot();
    render(<MarketplacePage />);

    await advance(9_999);
    expect(line()).toHaveTextContent('«marketplace.load.loading»');

    await advance(1);
    expect(line()).toHaveTextContent('«marketplace.load.slow»');
    expect(catalogCalls).toBe(1);

    fireEvent.click(screen.getByTestId('marketplace-load-slow-retry'));
    await advance(0);
    expect(catalogCalls).toBe(2);

    // The first read answering late settles nothing: the page waits on the
    // read Retry issued.
    answerFirst(listed());
    await advance(2_000);
    expect(card()).toBeNull();
    expect(line()).toHaveTextContent('«marketplace.load.loading»');
  });

  it('(f) control: a read that answers at once never draws the loading line', async () => {
    answers = [async () => listed()];
    await boot();
    render(<MarketplacePage />);

    await advance(0);
    expect(card()).toBeInTheDocument();
    await advance(15_000);
    expect(line()).toBeNull();
    expect(skeleton()).toBeNull();
  });

  it('unmount clears the phase timers of a pending read', async () => {
    answers = [() => new Promise<Response>(() => {})];
    await boot();
    const { unmount } = render(<MarketplacePage />);
    await advance(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('a failed catalog read names its class and offers Retry (objectui#12710)', () => {
  it('(c) no server answered: "could not be reached", and Retry reads again', async () => {
    answers = [
      async () => {
        throw new TypeError('Failed to fetch');
      },
      async () => listed(),
    ];
    await boot();
    render(<MarketplacePage />);

    await advance(0);
    expect(screen.getByTestId('marketplace-load-class')).toHaveTextContent('«marketplace.load.unreachable»');
    expect(screen.queryByText('«marketplace.noApprovedYet»')).toBeNull();
    expect(line()).toBeNull();

    fireEvent.click(screen.getByTestId('marketplace-load-retry'));
    await advance(0);
    expect(catalogCalls).toBe(2);
    expect(card()).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-load-failed')).toBeNull();
  });

  it('(d) a 503 answer: "answered with an error", with its status, and Retry', async () => {
    answers = [
      async () =>
        json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'catalog is down' } }, 503, 'Service Unavailable'),
    ];
    await boot();
    render(<MarketplacePage />);

    await advance(0);
    expect(screen.getByTestId('marketplace-load-class')).toHaveTextContent('«marketplace.load.answeredError:503»');
    expect(screen.getByTestId('marketplace-load-cause')).toHaveTextContent('catalog is down');
    expect(screen.getByTestId('marketplace-load-retry')).toBeEnabled();
  });

  it('(e) control: the Installed button is drawn and opens Packages filtered to Marketplace while the catalog has failed', async () => {
    answers = [
      async () => {
        throw new TypeError('Failed to fetch');
      },
    ];
    await boot();
    render(<MarketplacePage />);

    await advance(0);
    expect(screen.getByTestId('marketplace-load-failed')).toBeInTheDocument();
    const installed = screen.getByRole('button', { name: '«marketplace.installed»' });
    expect(installed).toBeEnabled();
    fireEvent.click(installed);
    // No app segment here (`useParams` answers `{}`), so Packages opens under the
    // Setup app's own; the button goes straight there, with no redirect hop
    // through a retired route (objectui#12733).
    expect(navigate).toHaveBeenCalledWith('/apps/setup/component/developer/packages?source=marketplace');
  });

  it('(f) the Installed button keeps the app segment it was opened under', async () => {
    params.value = { appName: 'crm' };
    answers = [async () => listed()];
    await boot();
    render(<MarketplacePage />);

    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: '«marketplace.installed»' }));
    expect(navigate).toHaveBeenCalledWith('/apps/crm/component/developer/packages?source=marketplace');
  });
});

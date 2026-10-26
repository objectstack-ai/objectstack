// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A marketplace load failure names its real cause, and the empty state is not
 * drawn under it (objectui#11688).
 *
 * ## The defect
 *
 * Browse Marketplace showed "Failed to load marketplace · Forbidden · This
 * runtime serves the marketplace catalog itself. Check that the runtime is
 * online.", then "No apps have been approved for the marketplace yet." below
 * it. (That hint sentence was itself wrong on this runtime, which proxies a
 * control plane; objectui#11726 reworded it, and
 * `MarketplacePage.sameOriginHint-11726.test.tsx` pins the new wording.)
 * The server had answered `403` with the `text/plain` body "Host not in
 * allowlist: cloud.objectos.ai. …", which is what an egress proxy in front of
 * the control plane sends; the runtime's marketplace proxy forwards it
 * verbatim. Three faults, one per line:
 *
 *   - `call()` parsed the body straight to JSON, threw the text away, and
 *     `readApiError` fell back to the status text, "Forbidden".
 *   - the "is it online" hint was drawn under EVERY failure, including one
 *     the server answered with its own reason.
 *   - the empty state did not know a load had failed, so it claimed an empty
 *     catalog the page never read.
 *
 * ## Why these cases drive the REAL `call()`
 *
 * The cause is lost inside `call()`, on how it reads a `Response`. A mocked
 * `listMarketplacePackages` rejecting with a hand-made `Error` would assert
 * against a stand-in for that read and prove nothing about it. So only the three
 * side loads are mocked; the catalog goes through the genuine module over a
 * stubbed `fetch` that answers with real `Response` objects.
 *
 * ## Why `t` returns «key»
 *
 * Same reason as `MarketplacePage.disabledState.test.tsx`: an echoed KEY proves
 * which string was chosen, and the `url` argument is appended so the configured
 * hint is seen to name the control plane the server reported.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      typeof opts?.url === 'string' ? `«${key}:${opts.url}»` : `«${key}»`,
    language: 'en',
  }),
}));

const listOrgPackages = vi.fn();

vi.mock('../marketplaceApi', async (importOriginal) => ({
  // `listMarketplacePackages` stays REAL: the defect lives in its `call()`.
  ...(await importOriginal<Record<string, unknown>>()),
  listLocalInstalls: async () => [],
  listOrgPackages: (...args: unknown[]) => listOrgPackages(...args),
  listInstalledPackages: async () => ({ connected: false, items: [] }),
}));

vi.mock('../../../assistant/assistantBus', () => ({ emitMetadataRefresh: () => {} }));

import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePage } from '../MarketplacePage';

/** What the sweep's runtime answered: an egress proxy's refusal, forwarded verbatim. */
const ALLOWLIST_TEXT =
  'Host not in allowlist: cloud.objectos.ai. Add this host to your network egress settings to allow access.';

const json = (body: unknown, status = 200, statusText = 'OK') =>
  new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/** The catalog request's answer, set per case. */
let catalog: () => Promise<Response>;

/** Boot the SPA against a runtime whose config reports `cloudUrl`, marketplace mounted. */
async function bootOn(cloudUrl: string) {
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).includes('/api/v1/marketplace/packages')
        ? catalog()
        : json({
            cloudUrl,
            singleEnvironment: true,
            features: { installLocal: true, marketplace: true, aiStudio: true, autoPublishAiBuilds: true },
            branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
          }),
    ),
  );
  await initRuntimeConfig();
}

beforeEach(() => {
  listOrgPackages.mockReset();
  listOrgPackages.mockResolvedValue({ connected: false, items: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('a failure the server answered shows the server its cause (objectui#11688)', () => {
  it.each([
    ['a runtime that names no upstream (`cloudUrl: ""`)', ''],
    ['a runtime reporting its control plane', 'https://cloud.acme.internal'],
  ])('a 403 whose plain-text body names the allowlist — on %s', async (_label, cloudUrl) => {
    await bootOn(cloudUrl);
    catalog = async () =>
      new Response(ALLOWLIST_TEXT, {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });

    render(<MarketplacePage />);

    await screen.findByText('«marketplace.load.failed»');
    // The cause is the server's text, not the status text that stood in for it.
    expect(screen.getByTestId('marketplace-load-cause')).toHaveTextContent(ALLOWLIST_TEXT);
    // The server answered, so "check that it is online" is not the cause.
    expect(screen.queryByTestId('marketplace-load-hint')).toBeNull();
    // And the page never read a catalog, so it claims nothing about one.
    expect(screen.queryByText('«marketplace.noApprovedYet»')).toBeNull();
  });

  it('a JSON envelope refusal still reads its message after the body is read as text', async () => {
    await bootOn('');
    catalog = async () =>
      json({ success: false, error: { code: 'FORBIDDEN', message: 'This environment may not browse the catalog.' } }, 403, 'Forbidden');

    render(<MarketplacePage />);

    expect(await screen.findByTestId('marketplace-load-cause')).toHaveTextContent(
      'This environment may not browse the catalog.',
    );
    expect(screen.queryByTestId('marketplace-load-hint')).toBeNull();
  });

  it('an HTML error page is not printed as the cause — only `text/plain` is read as prose', async () => {
    await bootOn('');
    catalog = async () =>
      new Response('<html><body><h1>403 Forbidden</h1></body></html>', {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'content-type': 'text/html' },
      });

    render(<MarketplacePage />);

    expect(await screen.findByTestId('marketplace-load-cause')).toHaveTextContent(/^Forbidden$/);
  });
});

describe('a failure whose cause IS reachability keeps the online hint (objectui#11688)', () => {
  it('a network failure — no server answered — shows the online hint', async () => {
    await bootOn('');
    catalog = async () => {
      throw new TypeError('Failed to fetch');
    };

    render(<MarketplacePage />);

    await screen.findByText('«marketplace.load.failed»');
    expect(screen.getByTestId('marketplace-load-hint')).toHaveTextContent('«marketplace.load.failedHintSameOrigin»');
    expect(screen.queryByText('«marketplace.noApprovedYet»')).toBeNull();
  });

  it('the runtime proxy reporting its upstream unreachable (502) shows its message and names the plane', async () => {
    await bootOn('https://cloud.acme.internal');
    catalog = async () =>
      json({ success: false, error: { code: 'MARKETPLACE_PROXY_FAILED', message: 'fetch failed' } }, 502, 'Bad Gateway');

    render(<MarketplacePage />);

    expect(await screen.findByTestId('marketplace-load-cause')).toHaveTextContent('fetch failed');
    expect(screen.getByTestId('marketplace-load-hint')).toHaveTextContent(
      '«marketplace.load.failedHintConfigured:https://cloud.acme.internal»',
    );
  });
});

describe('what the page draws beside a load failure (objectui#11688)', () => {
  it('control: a catalog that loaded empty draws the empty state, and no failure', async () => {
    await bootOn('');
    catalog = async () => json({ success: true, data: { items: [], total: 0, limit: 100, offset: 0 } });

    render(<MarketplacePage />);

    await screen.findByText('«marketplace.noApprovedYet»');
    expect(screen.queryByText('«marketplace.load.failed»')).toBeNull();
  });

  it('a catalog failure does not discard the org packages that did load', async () => {
    await bootOn('https://cloud.acme.internal');
    listOrgPackages.mockResolvedValue({
      connected: true,
      items: [{ id: 'pkg_1', manifest_id: 'acme.crm', display_name: 'Acme CRM' }],
    });
    catalog = async () =>
      new Response(ALLOWLIST_TEXT, {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'content-type': 'text/plain' },
      });

    render(<MarketplacePage />);

    expect(await screen.findByTestId('org-card-acme.crm')).toBeInTheDocument();
    expect(screen.getByTestId('marketplace-load-cause')).toHaveTextContent(ALLOWLIST_TEXT);
    expect(screen.queryByText('«marketplace.noApprovedYet»')).toBeNull();
  });
});

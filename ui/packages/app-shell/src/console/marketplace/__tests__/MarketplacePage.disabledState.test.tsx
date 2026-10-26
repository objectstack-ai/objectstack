// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Marketplace disabled by configuration" is a CONFIGURATION CONCLUSION, and a
 * failed request is not evidence of it (objectui#5504).
 *
 * ## The defect
 *
 * `apps/objectos-ee/deploy/.env.example` ships `OS_CLOUD_URL=off` as its factory
 * default, so a stock self-hosted stack mounts no marketplace proxy at all and
 * `/api/v1/marketplace/packages` 404s. This page rendered that as a red
 * "Failed to load marketplace / Not found" card whose hint claimed the runtime
 * "points at the public ObjectStack cloud by default" and advised setting
 * `OS_CLOUD_URL`. Neither was true of the deployment reading it.
 *
 * ## Why these cases drive the REAL runtime-config module
 *
 * The whole correctness argument is *where the disabled state comes from*. It
 * comes from `features.marketplace`, which `RuntimeConfigPlugin` derives per
 * request from the serving app's own route table (objectstack#8356) — never
 * from the shape of a failure. Mocking `isMarketplaceEnabled()` would assert
 * against a hand-written stand-in for that read and prove nothing about it, so
 * every case here boots the genuine `initRuntimeConfig()` over a stubbed
 * `GET /api/v1/runtime/config` payload and lets the real merge run.
 *
 * The payloads are the ones the plugin actually serves:
 *   - `OS_CLOUD_URL=off`   -> `{ cloudUrl: '', marketplace: false }` (the CLI's
 *     offline arm mounts runtime-config with `controlPlaneUrl: ''`, and the
 *     browse mount is absent, so the derived flag is false)
 *   - `OS_CLOUD_URL` unset -> `{ cloudUrl: 'https://cloud.objectos.ai', marketplace: true }`
 *     from a host whose `RuntimeConfigPlugin` resolves its URL, but
 *     `{ cloudUrl: '', marketplace: true }` from the CLI's cloud-connected
 *     arm, whose runtime-config is mounted with `controlPlaneUrl: ''` while
 *     its proxy forwards to that default plane (objectui#11726)
 *   - self-hosted plane    -> `{ cloudUrl: '<their URL>', marketplace: true }`
 *
 * ## The inversion this file exists to prevent
 *
 * `control plane merely DOWN` is the case that makes the naive fix wrong: it
 * produces the same failed request as `off`, and a page that concluded
 * "disabled by configuration" from it would tell an operator their config is
 * the problem while their control plane burns. That case is pinned below and
 * must stay a load failure forever.
 *
 * ## Why `t` returns «key»
 *
 * Same reason as `HomePage.authoringCapabilityGate.test.tsx`: a `t` echoing
 * `defaultValue` renders identical text whether or not the key is wired, so it
 * echoes the KEY. It also appends the `url` interpolation argument, because
 * "the hint names the control plane the server reported" is exactly the claim
 * under test — `«marketplace.load.failedHintConfigured:https://…»` fails if the
 * URL never reaches the string.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

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

const listMarketplacePackages = vi.fn();

vi.mock('../marketplaceApi', () => ({
  listMarketplacePackages: (...args: unknown[]) => listMarketplacePackages(...args),
  listLocalInstalls: async () => [],
  listOrgPackages: async () => ({ items: [] }),
  listInstalledPackages: async () => ({ items: [] }),
  installPackage: async () => ({}),
  installLocal: async () => ({}),
}));

vi.mock('../../../assistant/assistantBus', () => ({ emitMetadataRefresh: () => {} }));

import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePage } from '../MarketplacePage';

/** A `GET /api/v1/runtime/config` answer, as the server sends it. */
type ConfigBody = Record<string, unknown>;

const serverConfig = (cloudUrl: string, marketplace: boolean): ConfigBody => ({
  cloudUrl,
  singleEnvironment: true,
  features: { installLocal: true, marketplace, aiStudio: true, autoPublishAiBuilds: true },
  branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
});

/** Boot the SPA against a runtime that answers with `body`. */
async function bootOn(body: ConfigBody | null) {
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      body === null
        ? { ok: false, status: 404, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => body },
    ),
  );
  await initRuntimeConfig();
}

const CATALOG_404 = () => Promise.reject(new Error('Not found'));

beforeEach(() => {
  listMarketplacePackages.mockReset();
  listMarketplacePackages.mockResolvedValue({ items: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('a runtime deployed with OS_CLOUD_URL=off', () => {
  beforeEach(async () => {
    // What the EE template's factory default produces: no browse mount, so the
    // server's own derived flag is false.
    await bootOn(serverConfig('', false));
    listMarketplacePackages.mockImplementation(CATALOG_404);
  });

  it('renders the disabled state, not a load failure', () => {
    render(<MarketplacePage />);

    expect(screen.getByTestId('marketplace-disabled')).toBeInTheDocument();
    expect(screen.getByText('«marketplace.disabled.title»')).toBeInTheDocument();
    expect(screen.getByText('«marketplace.disabled.description»')).toBeInTheDocument();
    // The red card and BOTH of its hints are absent — the page is not reporting
    // a failure it did not have.
    expect(screen.queryByText('«marketplace.load.failed»')).toBeNull();
    expect(screen.queryByTestId('marketplace-load-hint')).toBeNull();
  });

  it('addresses its hint to the operator, naming the action rather than a diagnosis', () => {
    render(<MarketplacePage />);
    expect(screen.getByTestId('marketplace-disabled-hint')).toHaveTextContent(
      '«marketplace.disabled.hint»',
    );
  });

  it('issues no catalog request it already knows will 404', async () => {
    render(<MarketplacePage />);
    // Not merely "the error was swallowed": nothing was asked for. A request
    // fired here would spin the page before settling and put a guaranteed 404
    // in every operator's network log.
    await waitFor(() => expect(screen.getByTestId('marketplace-disabled')).toBeInTheDocument());
    expect(listMarketplacePackages).not.toHaveBeenCalled();
  });
});

describe('a runtime whose control plane is merely DOWN — the inversion guard', () => {
  it('stays a load failure and names the operator OWN control plane, never a default', async () => {
    // Self-hosted plane, configured and mounted (`marketplace: true`), upstream
    // unreachable. Identical failed request to the `off` case above; opposite
    // conclusion, because the runtime's own routing table still reports the
    // capability present.
    await bootOn(serverConfig('https://cloud.acme.internal', true));
    listMarketplacePackages.mockImplementation(CATALOG_404);

    render(<MarketplacePage />);

    await screen.findByText('«marketplace.load.failed»');
    expect(screen.queryByTestId('marketplace-disabled')).toBeNull();
    // The hint names THEIR plane. The retired string claimed the runtime was on
    // the public cloud "by default" and told them to set `OS_CLOUD_URL` — which
    // they already had.
    expect(screen.getByTestId('marketplace-load-hint')).toHaveTextContent(
      '«marketplace.load.failedHintConfigured:https://cloud.acme.internal»',
    );
  });

  it('names the public cloud by its URL when that is genuinely where the runtime points', async () => {
    await bootOn(serverConfig('https://cloud.objectos.ai', true));
    listMarketplacePackages.mockImplementation(CATALOG_404);

    render(<MarketplacePage />);

    await screen.findByText('«marketplace.load.failed»');
    expect(screen.getByTestId('marketplace-load-hint')).toHaveTextContent(
      '«marketplace.load.failedHintConfigured:https://cloud.objectos.ai»',
    );
  });

  it('names no plane when the runtime names none (`cloudUrl: ""`)', async () => {
    // `cloudUrl: ''` with the browse surface mounted says only that requests
    // stay on this origin. That is the control plane serving
    // `/api/v1/marketplace/*` natively, and it is equally the CLI's
    // cloud-connected arm proxying a plane it does not name (objectui#11726),
    // so the same-origin hint claims neither. Its wording is pinned with the
    // real packs in `MarketplacePage.sameOriginHint-11726.test.tsx`.
    await bootOn(serverConfig('', true));
    listMarketplacePackages.mockImplementation(CATALOG_404);

    render(<MarketplacePage />);

    await screen.findByText('«marketplace.load.failed»');
    expect(screen.getByTestId('marketplace-load-hint')).toHaveTextContent(
      '«marketplace.load.failedHintSameOrigin»',
    );
  });
});

describe('a runtime that answers nothing at all', () => {
  it('fails OPEN — an unanswered question never withholds a working marketplace', async () => {
    // A build predating `/api/v1/runtime/config`: the endpoint 404s and the SPA
    // keeps its defaults. Reading that as "disabled" would strip the catalog
    // from every older runtime that has one.
    await bootOn(null);

    render(<MarketplacePage />);

    expect(screen.queryByTestId('marketplace-disabled')).toBeNull();
    await waitFor(() => expect(listMarketplacePackages).toHaveBeenCalled());
  });
});

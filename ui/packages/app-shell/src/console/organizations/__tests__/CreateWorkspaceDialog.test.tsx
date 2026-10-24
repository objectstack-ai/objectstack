// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * CreateWorkspaceDialog — enable gate + born-with-env provision flow.
 *
 * Covers the three behaviours the multi-org self-service create flow relies on:
 *   1. enable gate     — when `multiOrgEnabled === false`, submit is blocked
 *                        client-side and never hits the org/env APIs.
 *   2. provision flow  — on success the dialog creates the org, eagerly
 *                        provisions its production environment, THEN signals
 *                        `onCreated` (the caller switches + navigates home).
 *   3. best-effort     — when eager provisioning throws, the user is still
 *                        landed (`onCreated`) so the lazy onboarding gate can
 *                        provision the env on first navigation.
 *
 * The browser's zone is stubbed at its reader,
 * `Intl.DateTimeFormat.prototype.resolvedOptions`, to `Asia/Shanghai`, so the
 * create call's argument does not depend on the zone of the machine running
 * the suite (objectui#11908).
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CreateWorkspaceDialog } from '../CreateWorkspaceDialog';
import { provisionProductionEnvironment } from '../provisionEnvironment';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
}));

vi.mock('../provisionEnvironment', () => ({
  provisionProductionEnvironment: vi.fn(),
}));

const createOrganization = vi.fn();
const getAuthConfig = vi.fn();
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ createOrganization, getAuthConfig }),
}));

const provisionMock = vi.mocked(provisionProductionEnvironment);

const NEW_ORG = { id: 'org-123', name: 'Acme Inc', slug: 'acme-inc' };

const BROWSER_ZONE = 'Asia/Shanghai';
const realResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
/** What the stubbed reader answers; `undefined` is a browser that reports no zone. */
let browserZone: string | undefined = BROWSER_ZONE;
let zoneReader: MockInstance;

beforeEach(() => {
  vi.clearAllMocks();
  getAuthConfig.mockResolvedValue({ features: { multiOrgEnabled: true } });
  createOrganization.mockResolvedValue(NEW_ORG);
  provisionMock.mockResolvedValue({ id: 'env-1', hostname: 'os-abc123.objectstack.app' });
  browserZone = BROWSER_ZONE;
  zoneReader = vi
    .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
    .mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...realResolvedOptions.call(this), timeZone: browserZone as string };
    });
});

afterEach(() => {
  zoneReader.mockRestore();
});

/** Let the `getAuthConfig().then(...)` effect settle (sets `multiOrgDisabled`). */
async function settleAuthConfig() {
  await waitFor(() => expect(getAuthConfig).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** The dialog asks for the name only (objectui#11659): there is no slug field to fill. */
function fillAndSubmit(name = NEW_ORG.name) {
  fireEvent.change(screen.getByTestId('workspace-name-input'), { target: { value: name } });
  const form = screen.getByTestId('create-workspace-dialog').querySelector('form');
  fireEvent.submit(form as HTMLFormElement);
}

describe('CreateWorkspaceDialog', () => {
  it('creates the org, eagerly provisions its production env, then signals onCreated', async () => {
    const onCreated = vi.fn();
    render(<CreateWorkspaceDialog open onOpenChange={() => {}} onCreated={onCreated} />);
    await settleAuthConfig();

    fillAndSubmit();

    await waitFor(() =>
      expect(createOrganization).toHaveBeenCalledWith({
        name: 'Acme Inc',
        slug: 'acme-inc',
        timezone: BROWSER_ZONE,
      }),
    );
    await waitFor(() =>
      // The workspace name is passed through as the production env displayName (#2228).
      expect(provisionMock).toHaveBeenCalledWith({ organizationId: 'org-123', displayName: 'Acme Inc' }),
    );
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'org-123' })),
    );

    // The env must be provisioned BEFORE we hand off to the caller's navigation.
    expect(provisionMock.mock.invocationCallOrder[0]).toBeLessThan(
      onCreated.mock.invocationCallOrder[0],
    );
  });

  it('blocks creation when multi-org is disabled, without calling the org/env APIs', async () => {
    getAuthConfig.mockResolvedValue({ features: { multiOrgEnabled: false } });
    render(<CreateWorkspaceDialog open onOpenChange={() => {}} />);
    await settleAuthConfig();

    fillAndSubmit();

    expect(await screen.findByTestId('workspace-create-error')).toBeInTheDocument();
    expect(createOrganization).not.toHaveBeenCalled();
    expect(provisionMock).not.toHaveBeenCalled();
  });

  it('still lands the user (onCreated) when eager provisioning fails — lazy-gate fallback', async () => {
    provisionMock.mockRejectedValue(new Error('cloud unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onCreated = vi.fn();
    render(<CreateWorkspaceDialog open onOpenChange={() => {}} onCreated={onCreated} />);
    await settleAuthConfig();

    fillAndSubmit();

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'org-123' })),
    );
    expect(provisionMock).toHaveBeenCalledTimes(1);
    // Provision failure is swallowed — no user-facing error, the lazy gate covers it.
    expect(screen.queryByTestId('workspace-create-error')).toBeNull();
    warn.mockRestore();
  });

  // objectui#11659 ruling 2: the dialog asks for the name only. The slug is
  // generated from the name, still sent with the create call, and stays
  // editable in organization settings.
  describe('asks for the name only (objectui#11659)', () => {
    it('renders no slug field — the name is the only input', async () => {
      render(<CreateWorkspaceDialog open onOpenChange={() => {}} />);
      await settleAuthConfig();

      const dialog = screen.getByTestId('create-workspace-dialog');
      expect(screen.queryByTestId('workspace-slug-input')).toBeNull();
      expect(dialog.querySelectorAll('input')).toHaveLength(1);
      expect(screen.getByTestId('workspace-name-input')).toBeInTheDocument();
    });

    it('sends the slug generated from the name, and the submit gate is the name alone', async () => {
      render(<CreateWorkspaceDialog open onOpenChange={() => {}} />);
      await settleAuthConfig();

      const submit = screen.getByTestId('workspace-create-submit');
      expect(submit).toBeDisabled();
      fireEvent.change(screen.getByTestId('workspace-name-input'), { target: { value: '博远贸易' } });
      expect(submit).not.toBeDisabled();
      fireEvent.submit(screen.getByTestId('create-workspace-dialog').querySelector('form') as HTMLFormElement);

      await waitFor(() => expect(createOrganization).toHaveBeenCalledTimes(1));
      const sent = createOrganization.mock.calls[0][0] as { name: string; slug: string };
      expect(sent.name).toBe('博远贸易');
      // A CJK name has no ASCII-sluggable characters: the deterministic fallback.
      expect(sent.slug).toMatch(/^workspace-[0-9a-z]+$/);
    });

    it('retries a slug collision with a suffixed slug instead of showing an error the user cannot fix', async () => {
      // A whole implementation, not a `…Once` queue: a queued value this case
      // leaves unconsumed (when the retry is missing) would survive
      // `vi.clearAllMocks()` and answer the next case's first call.
      createOrganization.mockImplementation(async ({ slug }: { slug: string }) => {
        if (slug === 'acme-inc') {
          throw Object.assign(new Error('Organization already exists'), { code: 'ORGANIZATION_ALREADY_EXISTS' });
        }
        return NEW_ORG;
      });
      const onCreated = vi.fn();
      render(<CreateWorkspaceDialog open onOpenChange={() => {}} onCreated={onCreated} />);
      await settleAuthConfig();

      fillAndSubmit();

      await waitFor(() =>
        expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'org-123' })),
      );
      expect(createOrganization).toHaveBeenCalledTimes(2);
      expect(createOrganization.mock.calls[0][0]).toEqual({
        name: 'Acme Inc',
        slug: 'acme-inc',
        timezone: BROWSER_ZONE,
      });
      const retry = createOrganization.mock.calls[1][0] as { slug: string; timezone?: string };
      expect(retry.slug).toMatch(/^acme-inc-[0-9a-z]{4}$/);
      // The retry is the same creation: it carries the same zone (objectui#11908).
      expect(retry.timezone).toBe(BROWSER_ZONE);
      expect(screen.queryByTestId('workspace-create-error')).toBeNull();
    });

    it('does not retry a refusal that is not a slug collision', async () => {
      createOrganization.mockRejectedValue(
        Object.assign(new Error('nope'), { code: 'YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION' }),
      );
      render(<CreateWorkspaceDialog open onOpenChange={() => {}} />);
      await settleAuthConfig();

      fillAndSubmit();

      expect(await screen.findByTestId('workspace-create-error')).toBeInTheDocument();
      expect(createOrganization).toHaveBeenCalledTimes(1);
      expect(provisionMock).not.toHaveBeenCalled();
    });
  });

  // objectui#11908: a new workspace takes the creator's browser zone at
  // creation, so its first administrator is not asked for one. The zone rides
  // the create call as `timezone`; `@object-ui/auth` puts it on the query
  // (`createOrganization-timezone-11908.test.ts` pins the wire).
  describe("sends the creator's browser zone (objectui#11908)", () => {
    it('a browser zone → the create call carries it as timezone, beside name and slug only', async () => {
      render(<CreateWorkspaceDialog open onOpenChange={() => {}} />);
      await settleAuthConfig();

      fillAndSubmit();

      await waitFor(() => expect(createOrganization).toHaveBeenCalledTimes(1));
      expect(createOrganization.mock.calls[0][0]).toStrictEqual({
        name: 'Acme Inc',
        slug: 'acme-inc',
        timezone: 'Asia/Shanghai',
      });
    });

    it.each([
      ['reports no zone', () => { browserZone = undefined; }],
      ['reports an empty zone', () => { browserZone = ''; }],
      ['throws on the read', () => {
        zoneReader.mockImplementation(() => {
          throw new RangeError('no time zone data');
        });
      }],
    ] as const)('control: a browser that %s → no timezone key at all', async (_label, arrange) => {
      arrange();
      render(<CreateWorkspaceDialog open onOpenChange={() => {}} />);
      await settleAuthConfig();

      fillAndSubmit();

      await waitFor(() => expect(createOrganization).toHaveBeenCalledTimes(1));
      const sent = createOrganization.mock.calls[0][0] as Record<string, unknown>;
      expect(Object.keys(sent).sort()).toEqual(['name', 'slug']);
    });
  });
});

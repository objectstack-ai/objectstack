/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * StorageUsageBanner (objectui#10439) — renders ONLY on the tenant runtime's
 * `warn` / `blocked` verdict, shows the served used / limit figures, carries the
 * upgrade entry on the full banner alone, and is for the environment admin.
 *
 * `classifyStorageUsage` is deliberately NOT mocked (only the data hook is), so
 * these cases exercise the same classifier the component ships with.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { StorageUsageSnapshot } from '../../hooks/useStorageUsageReading';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // Interpolates `{{name}}` from the options object, the way the real i18next
  // does for this copy's `{{used}}` / `{{limit}}` holes.
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
        String(options?.[name] ?? ''),
      ),
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: vi.fn(),
}));
vi.mock('../../hooks/useStorageUsageReading', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useStorageUsageReading: vi.fn(),
}));
vi.mock('../../console/marketplace/marketplaceApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  cloudConsoleUrl: vi.fn(),
}));

import { useWorkspaceAdminStatus } from '@object-ui/auth';
import { useStorageUsageReading } from '../../hooks/useStorageUsageReading';
import { cloudConsoleUrl } from '../../console/marketplace/marketplaceApi';
import { StorageUsageBanner } from '../StorageUsageBanner';

const asMock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

const CLOUD = 'https://cloud.example.test';

function setAdmin(isAdmin: boolean) {
  asMock(useWorkspaceAdminStatus).mockReturnValue({ isAdmin, isResolved: true });
}

function setSnapshot(snapshot: StorageUsageSnapshot) {
  asMock(useStorageUsageReading).mockReturnValue({ ...snapshot, refetch: vi.fn() });
}

const WARNING: StorageUsageSnapshot = {
  status: 'answered',
  reading: { state: 'warning', warn: true, blocked: false, usedMb: 850, limitMb: 1024 },
};
const BLOCKED: StorageUsageSnapshot = {
  status: 'answered',
  reading: { state: 'exhausted', warn: true, blocked: true, usedMb: 1100, limitMb: 1024 },
};

describe('StorageUsageBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAdmin(true);
    asMock(cloudConsoleUrl).mockReturnValue(CLOUD);
  });

  it('on `warn`, shows the used / limit figures and no upgrade entry', () => {
    setSnapshot(WARNING);
    render(<StorageUsageBanner />);

    const banner = screen.getByTestId('storage-usage-banner');
    expect(banner).toHaveAttribute('data-storage-usage-case', 'warning');
    expect(banner).toHaveTextContent('850 MB of 1,024 MB used');
    expect(banner).toHaveTextContent(/storage is filling up/i);
    // The adjudication gives the 80% banner the figures only; the upgrade entry
    // belongs to the full banner.
    expect(screen.queryByTestId('storage-usage-upgrade')).toBeNull();
    expect(banner.querySelector('a')).toBeNull();
  });

  it('on `blocked`, says uploads and imports are paused and carries the upgrade entry', () => {
    setSnapshot(BLOCKED);
    render(<StorageUsageBanner />);

    const banner = screen.getByTestId('storage-usage-banner');
    expect(banner).toHaveAttribute('data-storage-usage-case', 'blocked');
    expect(banner).toHaveTextContent(/storage is full: uploads and imports are paused/i);
    expect(banner).toHaveTextContent('1,100 MB of 1,024 MB used');

    const upgrade = screen.getByTestId('storage-usage-upgrade');
    expect(upgrade).toHaveAttribute('href', CLOUD);
    expect(upgrade).toHaveAttribute('target', '_blank');
    expect(upgrade).toHaveAttribute('rel', 'noopener noreferrer');
    expect(upgrade).toHaveTextContent(/upgrade/i);
  });

  // A runtime that names no upstream cloud has no control plane to send anyone
  // to: the full banner still renders, without a link.
  it('leaves the upgrade entry out when this runtime names no upstream cloud', () => {
    asMock(cloudConsoleUrl).mockReturnValue('');
    setSnapshot(BLOCKED);
    render(<StorageUsageBanner />);

    expect(screen.getByTestId('storage-usage-banner')).toHaveAttribute('data-storage-usage-case', 'blocked');
    expect(screen.queryByTestId('storage-usage-upgrade')).toBeNull();
  });

  it.each([
    ['the verdict is under the line (`ok`)', { status: 'answered', reading: { state: 'ok', warn: false, blocked: false, usedMb: 100, limitMb: 1024 } }],
    ['the endpoint answered its miss spelling (`unknown`)', { status: 'answered', reading: { state: 'unknown', warn: false, blocked: false } }],
    ['the plan is unlimited', { status: 'answered', reading: { state: 'unlimited', warn: false, blocked: false, usedMb: 50_000, limitMb: 0 } }],
    ['the endpoint could not be read (network or non-2xx)', { status: 'unavailable', reading: null }],
    ['nothing is known yet', { status: 'loading', reading: null }],
  ] as Array<[string, StorageUsageSnapshot]>)('renders nothing when %s', (_label, snapshot) => {
    setSnapshot(snapshot);
    const { container } = render(<StorageUsageBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is for the environment admin — an ordinary session renders nothing and issues no request', () => {
    setAdmin(false);
    setSnapshot({ status: 'idle', reading: null });
    const { container } = render(<StorageUsageBanner />);

    expect(container).toBeEmptyDOMElement();
    expect(asMock(useStorageUsageReading)).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });
});

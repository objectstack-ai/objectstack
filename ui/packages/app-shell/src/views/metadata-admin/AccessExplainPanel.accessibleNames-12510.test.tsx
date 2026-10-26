// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12510 — the Explain access sheet's controls carry names.
 *
 * The 2026-10-15 test pass read the User picker and the sheet's close button
 * as controls with no name. The browser's tree named the picker by the
 * principal it shows alone ("Me (calling principal)"): its visible "User"
 * label was bound to nothing. The label now names it, and the principal
 * follows, so the name reads "User Me (calling principal)". The close button
 * is "Close". Both are pinned by role.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => vi.fn(),
}));
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ({ find: vi.fn(async () => []) }),
}));
vi.mock('./useMetadata', () => ({
  useMetadataClient: () => ({ list: async () => [] }),
}));

import { AccessExplainPanel } from './AccessExplainPanel';
import { t } from './i18n';

afterEach(cleanup);

describe('the Explain access sheet names its controls (objectui#12510)', () => {
  it('the user picker is named by its "User" label, then the principal it shows; the sheet closes through "Close"', () => {
    render(<AccessExplainPanel open onOpenChange={() => {}} />);
    const sheet = screen.getByRole('dialog');
    const label = t('engine.studio.access.explain.user', 'en-US');
    const self = t('engine.studio.access.explain.self', 'en-US');
    expect(within(sheet).getByRole('button', { name: `${label} ${self}` })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /close/i })).toBeInTheDocument();
  });
});

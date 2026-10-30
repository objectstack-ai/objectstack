// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The New package dialog's description no longer says "project" (objectui#13126).
 *
 * The sentence read "Create a project-scoped package …" (zh 创建项目范围的软件包),
 * a scope word ObjectStack retired when it renamed project to environment
 * (ObjectStack ADR-0006). The dialog is not environment-scoped either, so the
 * description carries no scope word at all.
 *
 * The description is read off the rendered dialog through its
 * `aria-describedby` link, and its catalogue sentence is the positive control
 * that the node read is the description and not an empty one. (It used to be
 * the interpolated example id; objectstack#27833 took the id out of the first
 * step's copy.)
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PackageFormDialog } from './PackageFormDialog';
import { t } from './i18n';
// The zh rows live in `@object-ui/i18n`'s `studio` namespace, fetched on
// demand (objectstack#25922). Resident before any case, so the dialog and the
// positive control below read the same catalogue: rendering zh otherwise
// starts the fetch, and the control could read zh while the dialog had
// rendered the en fallback.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

let localeFixture: 'en-US' | 'zh-CN' = 'en-US';
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => localeFixture,
}));

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, text: async () => '{}' }) as Response),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function createDescription(): Promise<string> {
  render(<PackageFormDialog mode="create" open onOpenChange={vi.fn()} />);
  await screen.findByTestId('package-form');
  const dialog = screen.getByRole('dialog');
  const ids = (dialog.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  const text = ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
  // Positive control: the node read is the description's own sentence.
  expect(text).toContain(t('engine.packages.create.description', localeFixture));
  return text;
}

describe('New package dialog description (objectui#13126)', () => {
  it('carries no "project" scope word in English', async () => {
    localeFixture = 'en-US';
    const text = await createDescription();
    expect(text).not.toMatch(/project/i);
  });

  it('carries no 项目 scope word in Chinese', async () => {
    localeFixture = 'zh-CN';
    const text = await createDescription();
    expect(text).not.toMatch(/项目|project/i);
  });
});

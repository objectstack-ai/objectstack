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
 * `aria-describedby` link, and the interpolated `{example}` is the positive
 * control that the node read is the description and not an empty one.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PackageFormDialog } from './PackageFormDialog';

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
  // Positive control: the example id is interpolated into the description.
  expect(text).toContain('com.acme.crm');
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

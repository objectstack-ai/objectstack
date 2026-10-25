// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package form's labels were translated and the help line under each one
 * was not, so a zh console rendered 显示名称 over "Human-readable package
 * name" — objectui#5416 defect 2.
 *
 * The help text now resolves through the same i18n bundle as the label, for zh
 * ONLY. The en case below is the more important of the two: English must still
 * arrive from `@objectstack/spec`'s own `ManifestSchema` `.describe()` (the
 * framework repo), never from a copy in this repo's table that would silently
 * drift the next time the spec is edited.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ManifestSchema } from '@objectstack/spec/kernel';
import { PackageFormDialog } from './PackageFormDialog';

let localeFixture: 'en-US' | 'zh-CN' = 'zh-CN';
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => localeFixture,
}));

beforeEach(() => {
  localeFixture = 'zh-CN';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, text: async () => '{}' }) as Response),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('PackageFormDialog — help-text language (objectui#5416 defect 2)', () => {
  it('renders the help line in Chinese in a zh console', async () => {
    render(<PackageFormDialog mode="create" open onOpenChange={vi.fn()} />);
    await screen.findByTestId('package-form');

    expect(screen.getByText('软件包的可读名称。')).toBeInTheDocument();
    expect(screen.getByText('软件包的唯一标识，采用反向域名格式。')).toBeInTheDocument();
    expect(screen.getByText('软件包版本（语义化版本号）。')).toBeInTheDocument();

    // The card's exact complaint: a translated label with an English sentence
    // under it, on consecutive lines of the same field.
    // The English it must NOT show is read from the installed schema, so this
    // negative cannot go vacuous when the spec rewords a `.describe()`.
    expect(screen.queryByText(ManifestSchema.shape.name.description!)).toBeNull();
    expect(screen.queryByText(ManifestSchema.shape.id.description!)).toBeNull();
  });

  it('keeps ONE producer for the English: the spec, not this repo', async () => {
    localeFixture = 'en-US';
    render(<PackageFormDialog mode="create" open onOpenChange={vi.fn()} />);
    await screen.findByTestId('package-form');

    // These sentences are `ManifestSchema`'s `.describe()` in
    // `@objectstack/spec` (framework repo), reaching the row through the
    // spec-derived JSONSchema. Seeing them here proves `tOptional` found
    // nothing in the en table and fell through — i.e. this repo did not copy
    // the producer's English into a second table that would then drift.
    //
    // The expected text is read from the INSTALLED schema, not restated
    // (objectui#10207): a literal here fails by construction the day the spec
    // rewords a `.describe()`, although the producer-consumer seam this test
    // guards is still intact.
    for (const key of ['name', 'id', 'version'] as const) {
      const described = ManifestSchema.shape[key].description;
      expect(described, `ManifestSchema.${key} carries a .describe()`).toEqual(expect.any(String));
      expect(described!.trim()).not.toBe('');
      expect(screen.getByText(described!)).toBeInTheDocument();
    }
  });
});

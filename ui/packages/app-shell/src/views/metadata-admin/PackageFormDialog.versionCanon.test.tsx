// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package dialog's version gate is the INSTALLED spec's grammar, not a copy
 * of it (objectui#10207).
 *
 * The dialog used to carry its own `VERSION_RE`, a hand-copied three-numeric
 * grammar. `@objectstack/spec` is moving every package-version carrier onto the
 * SemVer 2.0.0 canon (objectstack#18697), at which point the copy would refuse
 * `2.0.0-beta.1` — a version the platform accepts — making the form stricter
 * than the contract it is a form for. The gate now asks `ManifestSchema`'s own
 * `version` field schema, so it moves with whichever spec is installed.
 *
 * The central pin is therefore an EQUALITY, not a list of verdicts: over the
 * sample list, the dialog accepts exactly what the installed spec field
 * accepts. The prerelease / build samples carry no hard-coded verdict here —
 * whatever the installed spec says is the right answer.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ManifestSchema } from '@objectstack/spec/kernel';
import { PackageFormDialog } from './PackageFormDialog';
import { t } from './i18n';

vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, text: async () => '{}' }) as Response),
  );
});
afterEach(() => vi.unstubAllGlobals());

const specAccepts = (v: string) => ManifestSchema.shape.version.safeParse(v).success;

/**
 * Samples, none with surrounding whitespace: the dialog trims the typed value
 * before judging it (unchanged behaviour), the spec field does not, so a padded
 * sample would compare two different strings.
 */
const SAMPLES = [
  '1.2.3',
  '0.1.0',
  '10.20.30',
  '01.1.1',
  '1.2',
  'v1.2.3',
  '1.2.3.4',
  'latest',
  '2.0.0-beta.1',
  '1.0.0+build',
  '1.0.0-rc.1+exp.sha.5114f85',
  '1.0.0-Beta.1',
] as const;

async function versionInput() {
  return screen.findByLabelText(t('engine.packages.create.version', 'en-US'), { exact: false });
}

function submitEnabled(): boolean {
  return !(screen.getByTestId('package-form-submit') as HTMLButtonElement).disabled;
}

/** Render the create form with every OTHER gate satisfied, then type `version`. */
async function createWithVersion(version: string): Promise<boolean> {
  render(<PackageFormDialog mode="create" open onOpenChange={vi.fn()} />);
  fireEvent.change(
    await screen.findByLabelText(t('engine.packages.create.id', 'en-US'), { exact: false }),
    { target: { value: 'com.acme.ver' } },
  );
  fireEvent.change(screen.getByLabelText(t('engine.packages.create.name', 'en-US'), { exact: false }), {
    target: { value: 'Ver App' },
  });
  fireEvent.change(await versionInput(), { target: { value: version } });
  return submitEnabled();
}

/** Render the edit form for a stored manifest carrying `version`. */
async function editWithVersion(version: string): Promise<boolean> {
  render(
    <PackageFormDialog
      mode="edit"
      open
      onOpenChange={vi.fn()}
      manifest={{ id: 'com.acme.ver', name: 'Ver App', version, type: 'app' }}
    />,
  );
  await screen.findByTestId('package-form');
  return submitEnabled();
}

describe('PackageFormDialog — version gate follows the installed spec (objectui#10207)', () => {
  it('the sample list is not vacuous: the installed spec accepts some and refuses some', () => {
    const verdicts = SAMPLES.map(specAccepts);
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });

  it.each(SAMPLES)('create: the dialog accepts %j exactly when the installed spec does', async (v) => {
    expect(await createWithVersion(v)).toBe(specAccepts(v));
  });

  it.each(SAMPLES)('edit: the dialog accepts %j exactly when the installed spec does', async (v) => {
    expect(await editWithVersion(v)).toBe(specAccepts(v));
  });

  // Verdicts that hold on the installed spec today AND on the SemVer 2.0.0
  // canon it is moving to — the no-behaviour-change floor of this card.
  it.each(['1.2.3'])('create: %j is accepted', async (v) => {
    expect(await createWithVersion(v)).toBe(true);
  });

  it.each(['1.2', 'v1.2.3', '1.2.3.4'])('create: %j is refused', async (v) => {
    expect(await createWithVersion(v)).toBe(false);
  });

  it('create: an empty version is refused', async () => {
    expect(await createWithVersion('')).toBe(false);
  });

  it('edit: a stored manifest with no version keeps the submit enabled', async () => {
    expect(await editWithVersion('')).toBe(true);
  });
});

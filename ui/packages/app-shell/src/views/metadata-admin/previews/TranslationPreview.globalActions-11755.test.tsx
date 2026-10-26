// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11755 — the translation designer's preview draws a `globalActions`
 * entry by its node's `label`.
 *
 * `TranslationDataSchema` declares `globalActions.NAME` as an action
 * translation node (`label`, `description`, `confirmText`, …), not a string.
 * The preview used to mark the category flat and draw each value with
 * `String(v)`, so every entry the spec accepts rendered as
 * `NAME[object Object]`. The category is now nested, and its sample shows the
 * node's `label`, quoted as a flat string is; a node without a `label` (the key
 * is optional) shows its inner key count, as the other nested categories do.
 *
 * Every fixture here is parsed by the installed spec's `TranslationDataSchema`
 * first, so no case passes on a bundle the spec would refuse. The pins read
 * the rendered row of the real component; the count row is read back through
 * `tFormat` rather than restated.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { TranslationDataSchema } from '@objectstack/spec/system';

import { t, tFormat } from '../i18n';
import { TranslationPreview } from './TranslationPreview';

afterEach(cleanup);

const LOCALE = 'en-US';

/** A bundle the installed spec accepts, mounted in the real preview. */
function mountSpecValid(data: Record<string, unknown>) {
  const parsed = TranslationDataSchema.safeParse(data);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  render(<TranslationPreview type="translation" name="fr" draft={{ locale: 'fr-FR', data }} locale={LOCALE} />);
}

/** The sample row's value text for `key` inside the card headed by the category row `labelKey`. */
function sampleValue(labelKey: string, key: string): string {
  const heading = screen.getByText(t(labelKey, LOCALE));
  const card = heading.closest('.rounded.border') as HTMLElement | null;
  expect(card, `${labelKey}: the category card`).toBeTruthy();
  const row = Array.from(card!.querySelectorAll('li')).find((li) => li.querySelector('code')?.textContent === key);
  expect(row, `${labelKey}: a sample row for ${key}`).toBeTruthy();
  return row!.querySelector('span')?.textContent ?? '';
}

const GLOBAL_ACTIONS = 'engine.translationPreview.category.globalActions';

describe('TranslationPreview draws a globalActions node by its label (objectui#11755)', () => {
  it('a spec-valid globalActions node renders its label, and no [object Object]', () => {
    mountSpecValid({ globalActions: { portfolio_snapshot: { label: 'Snapshot' } } });
    expect(sampleValue(GLOBAL_ACTIONS, 'portfolio_snapshot')).toBe('"Snapshot"');
    expect(document.body.textContent).not.toContain('[object Object]');
  });

  it('a node with its other translated fields still renders its label', () => {
    mountSpecValid({
      globalActions: { portfolio_snapshot: { label: 'Snapshot', confirmText: 'Take a snapshot?', successMessage: 'Done' } },
    });
    expect(sampleValue(GLOBAL_ACTIONS, 'portfolio_snapshot')).toBe('"Snapshot"');
    expect(document.body.textContent).not.toContain('[object Object]');
  });

  it('a node without a label renders its inner key count', () => {
    mountSpecValid({ globalActions: { archive: { confirmText: 'Archive?', successMessage: 'Archived' } } });
    expect(sampleValue(GLOBAL_ACTIONS, 'archive')).toBe(
      tFormat('engine.translationPreview.keyCountOther', LOCALE, { count: 2 }),
    );
    expect(document.body.textContent).not.toContain('[object Object]');
  });

  it('control: the flat and the other nested categories render as before', () => {
    mountSpecValid({
      messages: { welcome: 'Bienvenue' },
      objects: { account: { label: 'Compte', _actions: { close: { label: 'Fermer' } } } },
    });
    expect(sampleValue('engine.translationPreview.category.messages', 'welcome')).toBe('"Bienvenue"');
    // An object node keeps its key count: only the globalActions category reads a node's label.
    expect(sampleValue('engine.translationPreview.category.objects', 'account')).toBe(
      tFormat('engine.translationPreview.keyCountOther', LOCALE, { count: 2 }),
    );
  });
});

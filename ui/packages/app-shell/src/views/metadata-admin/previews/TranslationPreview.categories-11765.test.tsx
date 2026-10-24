// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11765 — the translation preview's categories are the groups of the
 * schema the designer validates against.
 *
 * The designer judges a translation draft with `validateMetadataDraft`, which
 * binds `TranslationItemSchema`: the groups of the per-app
 * `TranslationDataSchema` plus the item's own keys. The preview used to draw a
 * hand-kept list that had drifted from those groups. It omitted `picklists`,
 * `datasets`, `pages`, `flows` and `settingsCommon`, so a spec-valid bundle of
 * only one of them read as empty. It listed `validationMessages` (removed by
 * the spec) and `settings` (a platform-only group the per-app schema refuses),
 * so both counted toward the coverage denominator and a spec-valid bundle could
 * never reach full coverage.
 *
 * Every spec-valid fixture here is parsed by the installed spec's
 * `TranslationDataSchema` and passed through the designer's own
 * `validateMetadataDraft('translation', …)` before it is mounted. The expected
 * groups, their order and their count are read from `TranslationDataSchema`
 * itself, so a spec group added or dropped turns these pins red instead of
 * drifting. Headings and count rows are read back through `t` / `tFormat`
 * rather than restated.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { TranslationDataSchema } from '@objectstack/spec/system';

import { validateMetadataDraft } from '../clientValidation';
import { t, tFormat } from '../i18n';
import { TranslationPreview } from './TranslationPreview';

afterEach(cleanup);

const LOCALE = 'en-US';

/** The groups the spec declares, in its own order. */
const GROUPS = Object.keys(TranslationDataSchema.shape);

/** One spec-valid entry per group, the entry's key, and how its sample row reads. */
const ONE_ENTRY: Record<string, { data: Record<string, unknown>; key: string; row: () => string }> = {
  objects: { data: { account: { label: 'Compte' } }, key: 'account', row: () => keys(1) },
  picklists: {
    data: { stage: { label: 'Étape', options: { open: 'Ouvert', won: 'Gagné' } } },
    key: 'stage',
    row: () => keys(2),
  },
  apps: { data: { crm: { label: 'CRM' } }, key: 'crm', row: () => keys(1) },
  messages: { data: { welcome: 'Bienvenue' }, key: 'welcome', row: () => '"Bienvenue"' },
  globalActions: { data: { portfolio_snapshot: { label: 'Instantané' } }, key: 'portfolio_snapshot', row: () => '"Instantané"' },
  dashboards: { data: { pipeline: { label: 'Pipeline' } }, key: 'pipeline', row: () => keys(1) },
  datasets: {
    data: { revenue: { label: 'Revenu', measures: { amount: { label: 'Montant' } } } },
    key: 'revenue',
    row: () => keys(2),
  },
  pages: { data: { home: { label: 'Accueil' } }, key: 'home', row: () => keys(1) },
  flows: { data: { onboarding: { label: 'Intégration' } }, key: 'onboarding', row: () => keys(1) },
  metadataForms: { data: { object: { label: 'Objet' } }, key: 'object', row: () => keys(1) },
  // `settingsCommon` is one strict object, not a record of author-named nodes:
  // its members (`sourceLabels`) are what the card counts and samples.
  settingsCommon: {
    data: { sourceLabels: { env: 'Environnement', tenant: 'Locataire' } },
    key: 'sourceLabels',
    row: () => keys(2),
  },
};

/** The nested sample row for a node of `n` keys, in the row the preview picks for `n`. */
function keys(n: number): string {
  return tFormat(n === 1 ? 'engine.translationPreview.keyCountOne' : 'engine.translationPreview.keyCountOther', LOCALE, {
    count: n,
  });
}

function heading(group: string): string {
  return t(`engine.translationPreview.category.${group}`, LOCALE);
}

/** A bundle the spec and the designer both accept, mounted in the real preview as the designer hands it a draft. */
async function mountSpecValid(data: Record<string, unknown>) {
  const parsed = TranslationDataSchema.safeParse(data);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  const draft = { name: 'fr', locale: 'fr-FR', ...data };
  const gate = await validateMetadataDraft('translation', draft);
  expect(gate, 'the designer accepts the draft').toEqual({ ok: true, issues: [] });
  render(<TranslationPreview type="translation" name="fr" draft={draft} locale={LOCALE} />);
}

/** The heading of every category card, in the order the preview draws them. */
function cardHeadings(): string[] {
  const grid = document.querySelector('.grid');
  expect(grid, 'the category grid').toBeTruthy();
  return Array.from(grid!.children).map((card) => card.querySelector('span')?.textContent ?? '');
}

/** The card headed by `group`'s row. */
function card(group: string): HTMLElement {
  const el = screen.getByText(heading(group)).closest('.rounded.border') as HTMLElement | null;
  expect(el, `${group}: the category card`).toBeTruthy();
  return el!;
}

/** The value text of the sample row for `key` in `group`'s card. */
function sampleValue(group: string, key: string): string {
  const row = Array.from(card(group).querySelectorAll('li')).find((li) => li.querySelector('code')?.textContent === key);
  expect(row, `${group}: a sample row for ${key}`).toBeTruthy();
  return row!.querySelector('span')?.textContent ?? '';
}

function coverage(populated: number): string {
  return `${populated}/${GROUPS.length} (${Math.round((populated / GROUPS.length) * 100)}%)`;
}

describe('TranslationPreview draws the groups of the schema the designer validates against (objectui#11765)', () => {
  it('every group the spec declares has a spec-valid fixture here', () => {
    expect(Object.keys(ONE_ENTRY).sort()).toEqual([...GROUPS].sort());
  });

  it('draws one card per schema group, in the schema order, and divides coverage by their count', async () => {
    await mountSpecValid({ messages: ONE_ENTRY.messages.data });
    expect(cardHeadings()).toEqual(GROUPS.map(heading));
    expect(screen.getByText(coverage(1))).toBeTruthy();
  });

  for (const group of GROUPS) {
    it(`a spec-valid bundle of only ${group} reads non-empty and shows its card`, async () => {
      const entry = ONE_ENTRY[group];
      await mountSpecValid({ [group]: entry.data });
      expect(screen.queryByText(t('engine.translationPreview.empty', LOCALE))).toBeNull();
      expect(sampleValue(group, entry.key)).toBe(entry.row());
      expect(screen.getByText(coverage(1))).toBeTruthy();
    });
  }

  it('a bundle carrying every group reaches full coverage', async () => {
    await mountSpecValid(Object.fromEntries(GROUPS.map((g) => [g, ONE_ENTRY[g].data])));
    expect(screen.getByText(coverage(GROUPS.length))).toBeTruthy();
    expect(screen.queryByText(t('engine.translationPreview.categoryEmpty', LOCALE))).toBeNull();
  });

  it('a group the schema refuses is neither drawn as a category nor counted', async () => {
    const refused = { validationMessages: { required: 'Requis' }, settings: { theme: 'Thème' } };
    for (const [group, value] of Object.entries(refused)) {
      expect(TranslationDataSchema.safeParse({ [group]: value }).success, `${group} is refused by the spec`).toBe(false);
      const gate = await validateMetadataDraft('translation', { name: 'fr', locale: 'fr-FR', [group]: value });
      expect(gate.ok, `${group} is refused by the designer`).toBe(false);
    }
    render(
      <TranslationPreview
        type="translation"
        name="fr"
        draft={{ name: 'fr', locale: 'fr-FR', messages: ONE_ENTRY.messages.data, ...refused }}
        locale={LOCALE}
      />,
    );
    expect(cardHeadings()).toEqual(GROUPS.map(heading));
    expect(screen.getByText(coverage(1))).toBeTruthy();
    expect(screen.queryByText('required')).toBeNull();
    expect(screen.queryByText('theme')).toBeNull();
  });

  it('a nested node of one key reads the singular row, and of two keys the plural row', async () => {
    expect(keys(1), 'the singular row is not the plural row read with 1').not.toBe(keys(2).replace('2', '1'));
    await mountSpecValid({ pages: { home: { label: 'Accueil' }, about: { label: 'À propos', title: 'À propos de nous' } } });
    expect(sampleValue('pages', 'home')).toBe(keys(1));
    expect(sampleValue('pages', 'about')).toBe(keys(2));
  });

  it('control: the messages card renders as before', async () => {
    await mountSpecValid({ messages: { welcome: 'Bienvenue', saved: 'Enregistré' } });
    expect(sampleValue('messages', 'welcome')).toBe('"Bienvenue"');
    expect(sampleValue('messages', 'saved')).toBe('"Enregistré"');
  });
});

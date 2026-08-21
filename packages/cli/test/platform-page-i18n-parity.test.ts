// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Drift guard for the plugin-carried Setup pages' i18n (#3589).
 *
 * Three Setup pages ship as metadata inside capability plugins
 * (`@objectstack/cloud-connection`, `@objectstack/mcp`) while their
 * translations live in `@objectstack/platform-objects` — the two are edited
 * in different packages by different people. `translatePage` applies the
 * bundle for EVERY locale including `en`, so an `en` entry that has drifted
 * from the metadata literal silently *overrides* the newer authored copy
 * rather than falling back to it. Nothing else in the build notices.
 *
 * The pages are fed through the CLI's own `collectExpectedEntries` — the same
 * extractor behind `os i18n extract` / `coverage` — so this doubles as a
 * dogfood of that tooling against the platform's own shipped metadata.
 *
 * Placement: `packages/cli` is the only package that already depends on all
 * three, and it owns the i18n coverage tooling. `platform-objects` must not
 * depend on plugins (wrong direction), and the qa contract packages carry
 * none of them.
 */

import { describe, it, expect } from 'vitest';
import {
  MARKETPLACE_INSTALLED_UI_BUNDLE,
  CLOUD_CONNECTION_UI_BUNDLE,
} from '@objectstack/cloud-connection';
import { CONNECT_AGENT_UI_BUNDLE } from '@objectstack/mcp';
import { SetupAppTranslations } from '@objectstack/platform-objects';
import { translatePage } from '@objectstack/spec/system';
import { collectExpectedEntries } from '../src/utils/i18n-extract';

/** The pages exactly as the plugins register them with the kernel. */
const PAGES = [
  MARKETPLACE_INSTALLED_UI_BUNDLE.pages?.[0],
  CLOUD_CONNECTION_UI_BUNDLE.pages?.[0],
  CONNECT_AGENT_UI_BUNDLE.pages?.[0],
].filter(Boolean) as Array<Record<string, any>>;

const EN = 'en';
const pagesOf = (locale: string): Record<string, any> =>
  ((SetupAppTranslations as Record<string, any>)[locale]?.pages ?? {});

const read = (node: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>(
    (acc, seg) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[seg] : undefined),
    node,
  );

describe('plugin-carried Setup pages — i18n drift guard (#3589)', () => {
  it('finds all three pages through the plugins’ UI bundles', () => {
    expect(PAGES.map((p) => p.name).sort()).toEqual([
      'cloud_connection_settings',
      'connect_agent',
      'marketplace_installed',
    ]);
  });

  it('has an `en` translation entry for every page', () => {
    const en = pagesOf(EN);
    for (const page of PAGES) {
      expect({ page: page.name, hasEntry: Boolean(en[page.name]) })
        .toEqual({ page: page.name, hasEntry: true });
    }
  });

  it('keeps the `en` bundle byte-identical to the metadata literals', () => {
    // The real drift: someone edits `properties.subtitle` in the plugin and
    // leaves the bundle alone. `en` requests then render the STALE bundle
    // text, so the edit appears to do nothing.
    const en = pagesOf(EN);
    const expected = collectExpectedEntries({ pages: PAGES } as any)
      .filter((e) => e.path[0] === 'pages');

    expect(expected.length).toBeGreaterThan(0);

    for (const entry of expected) {
      const [, pageName, ...rest] = entry.path;
      const key = rest.join('.');
      expect({ page: pageName, key, value: read(en[pageName], key) })
        .toEqual({ page: pageName, key, value: entry.sourceValue });
    }
  });

  it('carries an entry for every page in every shipped locale (key sets, not leaf copy)', () => {
    // Scope, stated because this title used to promise “no silent English
    // fallback” — a guarantee the assertion below does not make. What it
    // compares is the SET OF PAGE NAMES under each locale’s `pages` against
    // `en`’s: an entry exists per page per locale, and no locale carries one
    // `en` lacks. It says nothing about the copy INSIDE an entry, which may
    // legitimately be the English source text — that is what the extractor
    // writes for an untranslated key under `--fill=default`, and under #8765’s
    // ruled Option B a leaf whose recorded source hash disagrees with the
    // current source is deliberately served as the source string (see
    // `platform-objects/src/apps/translations/source-hash.ts`, whose header
    // names this test as a key-set claim its fallback must not disturb).
    // Requiring each locale’s leaf to DIFFER from `en` is a coverage claim of
    // its own, not a restatement of this one.
    const locales = Object.keys(SetupAppTranslations as Record<string, unknown>);
    expect(locales).toContain(EN);
    expect(locales.length).toBeGreaterThan(1);

    const enKeys = Object.keys(pagesOf(EN)).sort();
    for (const locale of locales) {
      expect({ locale, pages: Object.keys(pagesOf(locale)).sort() })
        .toEqual({ locale, pages: enKeys });
    }
  });

  it('rewrites the page:header copy end-to-end for a non-English locale', () => {
    // The whole point of the chain: metadata in, localized header out.
    const headerOf = (page: Record<string, any>) => {
      for (const region of page.regions ?? []) {
        for (const component of region.components ?? []) {
          if (component.type === 'page:header') return component.properties ?? {};
        }
      }
      return {};
    };

    for (const page of PAGES) {
      // Snapshot by value up front — comparing two live reads of the same
      // object afterwards could not detect a mutation.
      const before = { ...headerOf(page) };
      const translated = translatePage(page as any, SetupAppTranslations, { locale: 'zh-CN' });
      const after = headerOf(translated);

      expect({ page: page.name, titleChanged: after.title !== before.title })
        .toEqual({ page: page.name, titleChanged: true });
      expect({ page: page.name, subtitleChanged: after.subtitle !== before.subtitle })
        .toEqual({ page: page.name, subtitleChanged: true });
      // Non-translatable props survive the overlay.
      expect({ page: page.name, icon: after.icon }).toEqual({ page: page.name, icon: before.icon });
      // The shared plugin-owned page object must not be mutated — it is a
      // module-level singleton the kernel registers once.
      expect({ page: page.name, header: headerOf(page) }).toEqual({ page: page.name, header: before });
    }
  });
});

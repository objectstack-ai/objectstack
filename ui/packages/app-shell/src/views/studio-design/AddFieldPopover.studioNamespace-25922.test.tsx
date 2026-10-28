// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#25922, (M) slice 1 — a Studio designer screen reads the strings
 * that moved into `@object-ui/i18n`'s `studio` namespace.
 *
 * The Data pillar's "Add field" popover reads the namespace through both
 * doors: its field labels (`designer.field.label` / `.apiName` / `.type`,
 * slice 1) straight from it, its chrome (`engine.studio.*`, slices S4 and S5)
 * through app-shell's `t()`, which answers from the namespace once the
 * designer table no longer holds the row. It takes its locale from
 * `useMetadataLocale()`, the hook every designer component uses, so this is
 * the path a real screen takes:
 *
 *   - zh: the namespace's `zh` catalogue is NOT resident when the screen first
 *     renders (this file runs in an isolated `dom` project and preloads
 *     nothing). The first paint reads the moved labels in English — the
 *     fallback, never the raw key — and the same mount re-renders in Chinese
 *     once the catalogue lands, chrome included.
 *   - de: a language the namespace does not ship renders English through both
 *     doors.
 *
 * Expectations are read from the namespace and `t()` rather than typed out, so
 * no case restates a translation.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import {
  isStudioCatalogueLoaded,
  loadStudioCatalogue,
  studioString,
} from '@object-ui/i18n/namespaces/studio';

import { t } from '../metadata-admin/i18n';
import { AddFieldPopover } from './AddFieldPopover';

afterEach(cleanup);

/** Keys this screen renders from the namespace. */
const MOVED = ['designer.field.label', 'designer.field.type'] as const;
/** A chrome key this screen reads through app-shell's `t()`. */
const CHROME = 'engine.studio.cancel';

function Screen({ lang }: { lang: string }) {
  return (
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
      <AddFieldPopover open onCreate={() => {}}>
        <button type="button">add</button>
      </AddFieldPopover>
    </I18nProvider>
  );
}

const popover = () => screen.getByTestId('add-field-popover');
/** The namespace's resident English row. */
const en = (key: string) => studioString(key, 'en')!;

describe('AddFieldPopover — strings from the studio namespace (objectstack#25922)', () => {
  it('zh: English while the catalogue is in flight, then Chinese on the same mount', async () => {
    // The premise: every one of these keys is the namespace's.
    for (const key of [...MOVED, CHROME]) expect(en(key), key).toBeDefined();
    expect(isStudioCatalogueLoaded('zh-CN')).toBe(false);

    render(<Screen lang="zh" />);

    // First paint: the fallback, not the key.
    for (const key of MOVED) {
      expect(popover()).toHaveTextContent(en(key));
      expect(popover()).not.toHaveTextContent(key);
    }

    // The catalogue lands (this awaits the fetch the screen started) and
    // `useMetadataLocale()` re-renders the same mount.
    const zh = await loadStudioCatalogue('zh-CN');
    for (const key of MOVED) expect(zh[key], key).not.toBe(en(key));
    expect(await screen.findByText(zh['designer.field.label'])).toBeInTheDocument();
    for (const key of MOVED) expect(popover()).toHaveTextContent(zh[key]);
    expect(popover()).toHaveTextContent(t(CHROME, 'zh-CN'));
    expect(t(CHROME, 'zh-CN')).not.toBe(t(CHROME, 'en-US'));
  });

  it('de: a third locale renders English through both doors', () => {
    render(<Screen lang="de" />);
    for (const key of MOVED) expect(popover()).toHaveTextContent(en(key));
    expect(popover()).toHaveTextContent(t(CHROME, 'en-US'));
    for (const key of MOVED) expect(t(key, 'de')).toBe(en(key));
  });
});

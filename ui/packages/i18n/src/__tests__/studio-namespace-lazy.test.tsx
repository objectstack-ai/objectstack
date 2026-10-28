/**
 * The `studio` namespace's lazy runtime (objectstack#25922) — what a Studio
 * screen observes, in the order it observes it:
 *
 *   1. before the `zh` catalogue has been fetched, a Chinese lookup answers
 *      from `en` — the documented fallback, never the raw key — and starts the
 *      fetch;
 *   2. a component that took `useStudioCatalogue()` re-renders in Chinese once
 *      the fetch lands;
 *   3. a language the namespace has no catalogue for (`de`) answers from `en`
 *      and fetches nothing.
 *
 * Runs in a `dom` project, which isolates each file's module graph, so the
 * namespace starts with only `en` resident. Case 1 is about that state and runs
 * first; the cases after it hold from either starting point.
 */
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';

import STUDIO_EN from '../namespaces/studio/en.js';
import STUDIO_ZH from '../namespaces/studio/zh.js';
import {
  isStudioCatalogueLoaded,
  loadStudioCatalogue,
  studioString,
  useStudioCatalogue,
} from '../namespaces/studio/index.js';

afterEach(cleanup);

/** A key whose two rows differ, so en and zh are tellable apart on screen. */
const KEY = Object.keys(STUDIO_EN).find((k) => STUDIO_ZH[k] !== undefined && STUDIO_ZH[k] !== STUDIO_EN[k])!;

function Probe({ lang }: { lang: string }) {
  useStudioCatalogue(lang);
  return <span data-testid="probe">{studioString(KEY, lang) ?? 'MISSING'}</span>;
}

describe('studio namespace — lazy zh', () => {
  it('answers from en before the zh catalogue lands, then re-renders in zh', async () => {
    expect(KEY).toBeDefined();
    expect(isStudioCatalogueLoaded('zh-CN')).toBe(false);

    render(<Probe lang="zh-CN" />);
    // The first paint: the fetch cannot have resolved synchronously.
    expect(screen.getByTestId('probe').textContent).toBe(STUDIO_EN[KEY]);

    // The same component, with no prop change, once the chunk arrives.
    expect(await screen.findByText(STUDIO_ZH[KEY])).toBeTruthy();
    expect(isStudioCatalogueLoaded('zh')).toBe(true);
  });

  it('a third locale renders en and needs no fetch', async () => {
    expect(isStudioCatalogueLoaded('de')).toBe(true);
    render(<Probe lang="de" />);
    expect(screen.getByTestId('probe').textContent).toBe(STUDIO_EN[KEY]);
    await expect(loadStudioCatalogue('de')).resolves.toBe(STUDIO_EN);
  });
});

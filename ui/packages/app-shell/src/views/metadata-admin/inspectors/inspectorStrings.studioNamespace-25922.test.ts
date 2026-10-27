// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#25922 slice S2 — the page block, action, dataset, flow node, app
 * navigation and dashboard widget inspector rows (`engine.inspector.{pageBlock,
 * action,dataset,flowNode,appNav,widget}.*`) live in `@object-ui/i18n`'s
 * `studio` namespace, and app-shell's `t()` still answers every one of them the
 * way it did when they sat in its own table.
 *
 * What would break it:
 *   - a row copied back into the app-shell table with a different value — the
 *     table is asked first, so it would shadow the namespace silently;
 *   - the namespace fallback dropped from `lookupString` — every moved key
 *     would echo back as itself;
 *   - a family emptied out of the namespace, which every per-key assertion
 *     below would then pass over nothing. The floors are per FAMILY, by name,
 *     so one family draining cannot hide behind another one growing.
 *
 * The oracle is the namespace's own catalogues, read through
 * `loadStudioCatalogue` (the module's public door), not a copy of their text.
 */
import { describe, expect, it } from 'vitest';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
import { t } from '../i18n';

const EN = await loadStudioCatalogue('en');
// Resident before any case, so the zh lookups below read synchronously.
const ZH = await loadStudioCatalogue('zh');

/** Family → the fewest keys it may carry (measured at the move, rounded down). */
const S2_FAMILY_FLOOR: Readonly<Record<string, number>> = Object.freeze({
  pageBlock: 160,
  action: 120,
  dataset: 80,
  flowNode: 40,
  appNav: 40,
  widget: 40,
});

const familyKeys = (family: string): string[] =>
  Object.keys(EN).filter((key) => key.startsWith(`engine.inspector.${family}.`));

describe('S2 inspector rows answer from the studio namespace (objectstack#25922)', () => {
  it.each(Object.entries(S2_FAMILY_FLOOR))('%s: the namespace carries the family, in en and zh', (family, floor) => {
    const keys = familyKeys(family);
    expect(keys.length).toBeGreaterThanOrEqual(floor);
    expect(keys.filter((key) => !(key in ZH))).toEqual([]);
  });

  it.each(Object.keys(S2_FAMILY_FLOOR))('%s: t() answers every key with the namespace value', (family) => {
    const wrong = familyKeys(family).flatMap((key) => {
      const out: string[] = [];
      if (t(key, 'en-US') !== EN[key]) out.push(`en-US ${key}: ${t(key, 'en-US')}`);
      if (t(key, 'zh-CN') !== ZH[key]) out.push(`zh-CN ${key}: ${t(key, 'zh-CN')}`);
      // A language the namespace has no catalogue for reads English, as it did
      // from the app-shell table.
      if (t(key, 'de-DE') !== EN[key]) out.push(`de-DE ${key}: ${t(key, 'de-DE')}`);
      return out;
    });
    expect(wrong).toEqual([]);
  });
});

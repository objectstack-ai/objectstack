// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25901 — `viewTabLabel` resolves a view's `I18nLabel` in the viewer's
 * language before either branch, so no caller receives an inline locale map.
 *
 * The header, the object page's tab bar, the mobile view switcher and the
 * record page's way back all draw this function's answer as text. Before the
 * change a map label came back as the map itself — on the served branch drawn
 * as given, on the other offered to the bundle as the fallback, which the
 * bundle returns untouched on a miss — and React threw on it
 * (`AppHeader.inlineViewLabel-25901` pins the header, where the throw took the
 * whole console down).
 *
 * The served/derived split is unchanged: a served view's resolved text is drawn
 * as given, any other view's goes through `viewLabel` with the resolved text as
 * its fallback, so a catalog entry still wins there.
 */
import { describe, it, expect, vi } from 'vitest';
import { viewTabLabel, type ViewLabelLookup } from './viewTabLabel';

const OBJECT = 'recheck_gate';
const UNLABELLED = 'QA Gates';
const LABEL = { en: 'My gates', 'zh-CN': '我的关卡' };

/** The `/meta/object` read served `served_map`; `derived_map` it did not. */
const SERVED = Object.freeze({
  views: [] as readonly unknown[],
  objects: [{ name: OBJECT, listViews: { served_map: { label: LABEL } } }] as readonly unknown[],
});

/** A bundle with no entry for any view: every lookup answers its fallback. */
const missingBundle: ViewLabelLookup = (_object, _view, fallback) => fallback;

describe('viewTabLabel resolves an inline locale-map label (#25901)', () => {
  it.each([
    ['en', 'My gates'],
    ['zh-CN', '我的关卡'],
    ['zh', '我的关卡'],
  ])('a served view, %s', (language, expected) => {
    const lookup = vi.fn(missingBundle);
    const text = viewTabLabel({ id: 'served_map', name: 'served_map', label: LABEL }, OBJECT, SERVED, lookup, UNLABELLED, language);

    expect(text).toBe(expected);
    // Drawn as given: the served branch never asks the bundle.
    expect(lookup).not.toHaveBeenCalled();
  });

  it('a view no server read served hands the bundle the RESOLVED text as its fallback', () => {
    const lookup = vi.fn(missingBundle);
    const text = viewTabLabel({ id: 'derived_map', name: 'derived_map', label: LABEL }, OBJECT, SERVED, lookup, UNLABELLED, 'zh-CN');

    expect(text).toBe('我的关卡');
    expect(lookup).toHaveBeenCalledWith(OBJECT, 'derived_map', '我的关卡');
  });

  it('a catalog entry still wins for a view no server read served', () => {
    const catalog: ViewLabelLookup = () => 'Catalog gates';
    expect(viewTabLabel({ id: 'derived_map', name: 'derived_map', label: LABEL }, OBJECT, SERVED, catalog, UNLABELLED, 'zh-CN')).toBe('Catalog gates');
  });

  it('a map that resolves to no text is drawn as the unlabelled text', () => {
    expect(viewTabLabel({ id: 'served_map', name: 'served_map', label: {} }, OBJECT, SERVED, missingBundle, UNLABELLED, 'en')).toBe(UNLABELLED);
    expect(viewTabLabel({ id: 'served_map', name: 'served_map', label: { en: '  ' } }, OBJECT, SERVED, missingBundle, UNLABELLED, 'en')).toBe(UNLABELLED);
  });

  it('control — a string label is drawn as before', () => {
    expect(viewTabLabel({ id: 'served_map', name: 'served_map', label: 'Open gates' }, OBJECT, SERVED, missingBundle, UNLABELLED, 'zh-CN')).toBe('Open gates');
    expect(viewTabLabel({ id: 'served_map', name: 'served_map' }, OBJECT, SERVED, missingBundle, UNLABELLED, 'en')).toBe(UNLABELLED);
  });
});

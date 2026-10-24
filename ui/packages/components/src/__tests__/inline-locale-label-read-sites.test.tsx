/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Renderers that read `schema.label` resolve the INLINE locale map (objectui#4580).
 *
 * `BaseSchema.label` and `.description` accept `string | I18nLabel` since
 * #4580's revised Q1 ruling (comment 5284973826) — `I18nLabel` being the spec's
 * INLINE locale MAP (`string | Record<string, string>` in `@objectstack/spec`
 * 17.0.0-rc.6). The DECLARED half of that is re-derived by
 * `inline-locale-declared-face-9092.test.ts` in `@object-ui/types`; the READ
 * half is re-derived by the cases below.
 *
 * ⚠️ The producer sentence this header carried is DEAD — quoted and dated,
 * not deleted. As written on 2026-08-13 (#4580, PR #4608) it read, truly of the
 * tree at that commit:
 *
 * > the shape a spec producer already writes: `bridgeListView` assigns
 * > `node.label = spec.label` at `list-view.ts:180`
 *
 * ⛔ FALSIFIED on 2026-08-29 by objectui#6366 (PR #6632), which removed the
 * whole spec-bridge — `SpecBridge`, `bridgeListView`, `bridgeFormView` — from
 * `@object-ui/react` as a declared BREAKING CHANGE. ⛔ Nothing re-derives that
 * sentence, so it is quoted rather than left reading as live (AGENTS.md #9): a
 * test header is the worst place for a confident sentence about a producer that
 * is gone, and reading it as live already cost objectui#9092 a
 * premise-falsification round.
 *
 * Resolution happens at READ time, here, against the display locale — NOT at
 * the spec bridge. PR #4603 measured the bridge unable to do it: it is a plain
 * class method that cannot call a hook, `BridgeContext` declares no locale, and
 * `updateContext()` has zero callers, so a bridge-resolved label would freeze
 * one audience's language into the node tree (the spec's own resolver doc
 * records that defect class as objectstack#6761).
 *
 * ## The site class, and why these three are ONE case
 *
 * The widening turned every blind `schema.label`-as-string read into a named
 * TS2322 — that compiler inventory IS the audit, and it named exactly four
 * sites repo-wide, all of them the SAME class: the label reaching a React child
 * position. Three are in this package; the fourth is
 * `plugin-dashboard/src/DashboardGridLayout.tsx` and is pinned in that package.
 *
 * ⚠️ 2026-10-02: one of the three is gone. `sidebar-group`'s read site lived in
 * its registration, and objectui#10859 batch 8 phase 2d retired that node key
 * (the ten `sidebar-*` parts), so its two cases below went with it. Two sites
 * remain in this package, `filter-builder` and `dropdown-menu`. The red-first
 * reading that follows is quoted as measured, three renderers included.
 *
 * ## Red-first — measured BEFORE the fix, verbatim
 *
 * Each of the three renderers below was invoked with
 * `label: { en: 'Owner', 'zh-CN': '负责人' }` against the unfixed source. All
 * three THREW, with byte-identical messages:
 *
 * ```
 * Objects are not valid as a React child (found: object with keys {en, zh-CN}).
 * If you meant to render a collection of children, use an array instead.
 * ```
 *
 * Not `[object Object]` — a throw. A text node is one of the positions React
 * refuses outright rather than stringifying, so the pre-fix harm is the whole
 * subtree failing to render, not a cosmetic mis-render.
 *
 * ⚠️ **`dropdown-menu`'s harm is invisible unless the menu is OPEN.** Radix
 * mounts `DropdownMenuContent` lazily, so the first probe of that renderer
 * returned an EMPTY container and no throw — a case that would have shipped
 * looking green while proving nothing. `defaultOpen: true` is what makes the
 * label reachable, and it is load-bearing in the case below for that reason.
 *
 * ## Why these invoke the registered renderer DIRECTLY
 *
 * Same reason PR #4603's toggle case does: `SchemaRenderer` injects its own
 * props around a renderer, and a test driven through it can be green in both
 * directions. `ComponentRegistry.get(name)` returns the component the registry
 * actually renders (`React.createElement`, `SchemaRenderer.tsx:621`) — which is
 * also why calling `useDisplayLocale()` inside these renderers is legal.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

/** The inline locale map an author writes; `zh-CN` exists so a switch is observable. */
const INLINE_MAP = { en: 'Owner', 'zh-CN': '负责人' } as const;

/**
 * Render a registered renderer directly, with the display locale pinned.
 *
 * `useDisplayLocale()` is `tenantLocale || uiLanguage || 'en'`, so driving
 * `LocalizationProvider` sets it deterministically rather than depending on the
 * ambient react-i18next instance.
 */
function renderDirect(
  name: string,
  schema: Record<string, unknown>,
  tenantLocale?: string,
) {
  const C = ComponentRegistry.get(name) as React.ComponentType<any>;
  return render(
    <I18nProvider persistLanguage={false}>
      <LocalizationProvider value={{ locale: tenantLocale }}>
        <C schema={schema} />
      </LocalizationProvider>
    </I18nProvider>,
  );
}

describe('label read sites resolve the inline locale map (objectui#4580)', () => {
  /* ── filter-builder ──────────────────────────────────────────────────── */

  describe('filter-builder', () => {
    it('resolves the map for the display locale', () => {
      renderDirect('filter-builder', { type: 'filter-builder', label: INLINE_MAP, fields: [] }, 'zh-CN');
      expect(screen.getByText('负责人')).toBeInTheDocument();
    });

    it('resolves the same map differently for a different locale', () => {
      renderDirect('filter-builder', { type: 'filter-builder', label: INLINE_MAP, fields: [] }, 'en');
      expect(screen.getByText('Owner')).toBeInTheDocument();
    });

    it('passes a plain string through unchanged', () => {
      renderDirect('filter-builder', { type: 'filter-builder', label: 'Filters', fields: [] }, 'zh-CN');
      expect(screen.getByText('Filters')).toBeInTheDocument();
    });
  });

  /* ── dropdown-menu ───────────────────────────────────────────────────── */

  describe('dropdown-menu', () => {
    // `defaultOpen` is load-bearing: Radix mounts the content lazily, so without
    // it this case renders an empty container and proves nothing (measured).
    it('resolves the map for the display locale', () => {
      renderDirect(
        'dropdown-menu',
        { type: 'dropdown-menu', label: INLINE_MAP, items: [], defaultOpen: true },
        'zh-CN',
      );
      expect(screen.getByText('负责人')).toBeInTheDocument();
    });

    it('passes a plain string through unchanged', () => {
      renderDirect(
        'dropdown-menu',
        { type: 'dropdown-menu', label: 'Actions', items: [], defaultOpen: true },
        'zh-CN',
      );
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });
  });

  /* ── The resolver's documented fallback ──────────────────────────────── */

  /**
   * The spec's `resolveI18nLabel` documents its fallback order as exact match →
   * base/region (`zh-CN` ↔ `zh`) → last resort (any remaining entry), returning
   * `undefined` when nothing matched. These pin the two limbs past "exact",
   * because a resolver that only ever hits the exact limb is indistinguishable
   * from a lookup that ignores the locale entirely.
   */
  describe("the spec resolver's documented fallback", () => {
    it('falls back from a region tag to its base language', () => {
      // Author wrote only `zh`; viewer is `zh-CN`.
      renderDirect(
        'filter-builder',
        { type: 'filter-builder', label: { en: 'Owner', zh: '负责人' }, fields: [] },
        'zh-CN',
      );
      expect(screen.getByText('负责人')).toBeInTheDocument();
    });

    it('falls back to a remaining entry when no limb matches', () => {
      // Author wrote only `ja-JP`; viewer is `fr` — the doc's last-resort limb.
      renderDirect(
        'filter-builder',
        { type: 'filter-builder', label: { 'ja-JP': '所有者' }, fields: [] },
        'fr',
      );
      expect(screen.getByText('所有者')).toBeInTheDocument();
    });
  });
});

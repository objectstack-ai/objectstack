/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4984 item 2 — the LABEL half of the date-range preset fan-out.
 *
 * objectui#4167 made `@object-ui/core`'s `DATE_RANGE_PRESETS` the spec's own
 * array by reference, so a preset `@objectstack/spec` ADDS arrives in the
 * dashboard filter dropdown for free. Two things then have to follow it, and
 * only one of them was pinned:
 *
 *   - BOUNDS — `packages/core/src/utils/__tests__/dashboard-filters.test.ts`
 *     ("every offered preset resolves to date-macro bounds") already asserts a
 *     preset with no entry in the bounds table is caught. That is the half with
 *     teeth at runtime.
 *   - LABELS — nothing. `DashboardFilterBar.tsx` builds the key dynamically
 *     — the key is `dashboard.filters.range.` followed by the member name, and
 *     the fallback it degrades to is `p.replace(/_/g, ' ')` — so
 *     `check:i18n-keys` cannot see a template-literal key, and the call site
 *     degrades SILENTLY: the new preset renders as its own member name with the
 *     underscores swapped for spaces — `next_week` as "next week", in Chinese,
 *     Japanese and Arabic alike — with every gate green.
 *
 * So the one class of change the vocabulary extraction was designed to make
 * painless is also the one that would ship untranslated in ten locales. This
 * file is that missing pin, and it is deliberately the mirror of the bounds-half
 * test: same source of truth (`DATE_RANGE_PRESETS`, not a copy of it), same
 * "every offered preset …" shape.
 *
 * ── Scope: `en` only, on purpose ─────────────────────────────────────────────
 * `en` is where the vocabulary/label tie lives — it is the pack every other one
 * is backfilled from and the one `fallbackLng: 'en'` degrades to. The 10-locale
 * spread is the i18n channel's existing business: `en-zh-key-parity.test.ts`
 * carries `zh` off this pin for free, and the remaining eight packs are tracked
 * under objectui#2872 part a.
 *
 * ── This file lives in `@object-ui/i18n`, not in core ────────────────────────
 * The claim spans the vocabulary and the locale packs. `@object-ui/i18n`
 * depends on `@object-ui/core`, so it can reach both; core cannot reach the
 * packs without inverting that edge. `@objectstack/spec` is deliberately NOT
 * imported here — it is not a dependency of this package, and reading the
 * vocabulary through `@object-ui/core` is the same reference anyway (pinned by
 * `toBe` in the bounds-half file).
 *
 * ── PREDICTIONS, written before the run ──────────────────────────────────────
 * GREEN on `main` today: the vocabulary is byte-faithful — 13 presets, 13 `en`
 * labels. That is exactly why a pin here is cheap now, and exactly why a green
 * run proves nothing on its own. The discriminating evidence is the mutation
 * legs recorded in the PR, which drive each assertion RED on its own:
 *   - delete one `en` key            → "every preset has an `en` label" RED
 *   - add a label with no preset     → "no orphan labels" RED
 */
import { describe, it, expect } from 'vitest';
import { DATE_RANGE_PRESETS } from '@object-ui/core';
import { builtInLocales } from '../locales';

/**
 * The namespace `DashboardFilterBar.tsx` builds its key under. Written out
 * because the call site's key is a template literal — no static analysis
 * connects the two, which is the whole reason this file exists.
 */
const RANGE_NS = ['dashboard', 'filters', 'range'] as const;

const rangeLabels = (): Record<string, unknown> => {
  const node = RANGE_NS.reduce<unknown>(
    (acc, seg) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[seg] : undefined),
    builtInLocales.en,
  );
  if (!node || typeof node !== 'object') {
    throw new Error(`en.${RANGE_NS.join('.')} is missing — the label table moved or was renamed`);
  }
  return node as Record<string, unknown>;
};

describe('dashboard date-range preset labels (en) track DATE_RANGE_PRESETS', () => {
  it('reads a non-empty vocabulary and a non-empty label table', () => {
    // Guards the vacuous pass: if either side resolved to nothing, every
    // assertion below would iterate zero times and report green. The counts are
    // NOT pinned to today's 13 — pinning the number would re-create the very
    // hand-maintained copy this file exists to retire.
    expect(DATE_RANGE_PRESETS.length).toBeGreaterThan(5);
    expect(Object.keys(rangeLabels()).length).toBeGreaterThan(5);
  });

  it('every offered preset has an `en` label', () => {
    // A preset with no key here is not a missing translation — it is a dropdown
    // item rendered as its own member name (`last_90_days` → "last 90 days") in
    // every locale at once, because the call site's `defaultValue` fallback is
    // the member name with underscores replaced.
    const labels = rangeLabels();
    const missing = DATE_RANGE_PRESETS.filter((p) => typeof labels[p] !== 'string' || !(labels[p] as string).trim());
    expect(missing).toEqual([]);
  });

  it('has no orphan label left behind by a preset the spec removed', () => {
    // The other direction of the same tie. `custom` is deliberately not a
    // member of DATE_RANGE_PRESETS and is not labelled here either — it has its
    // own sibling key, `dashboard.filters.custom`.
    const orphans = Object.keys(rangeLabels()).filter(
      (k) => !(DATE_RANGE_PRESETS as readonly string[]).includes(k),
    );
    expect(orphans).toEqual([]);
  });
});

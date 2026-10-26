/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5435 — the fold's output is AUTHORABLE.
 *
 * The card was filed against `@objectstack/spec@17.0.0`, where
 * `normalizeListViewSchema` folded three legacy `show*` flags onto
 * `userActions.group` / `.hideFields` / `.rowColor` — keys
 * `UserActionsConfigSchema` did not declare, so the fold's own output was
 * refused BY NAME by the schema a stored view is validated against.
 *
 * That gap is CLOSED upstream, not here: the maintainer ruled Option A
 * (2026-08-22), the spec adopted all three, and the declaring docblock names
 * this card by number (`@objectstack/spec` `src/ui/view.zod.ts`, the three at
 * `:1045` / `:1048` / `:1049`, the card named at `:1020`). ⛔ objectui does NOT
 * retire the three toggles — the renderer honours them and the protocol now
 * declares them, so tombstoning them here would make objectui NARROWER than the
 * protocol.
 *
 * ⛔ This file therefore pins the POSITIVE fact — the fold's output is
 * authorable — and never that the keys are dead. What it exists to catch:
 *
 *   · the spec dropping any of the three   ⇒ the emitted block stops parsing ⇒ RED
 *   · the fold emitting a NEW undeclared key ⇒ the residual grows ⇒ RED
 *   · the ON/OFF default asymmetry flipping ⇒ RED (it is LOAD-BEARING: the spec
 *     copied it FROM `ListView.tsx`'s reads, so a flip silently changes what
 *     the author gets without either side changing code)
 *
 * ⚠️ NOT VACUOUS BY CONSTRUCTION. Two firing controls below prove the harness
 * reddens when a key genuinely is refused; without them "everything parsed" is
 * equally consistent with a schema that refuses nothing. Every population is
 * asserted at its exact size before it is used, because a census over an empty
 * set passes.
 *
 * ⚠️ SCOPED OUT — `viewType`. The fold also writes `viewType`, objectui's
 * legacy spelling of the spec's `type`, which the spec refuses by name. That is
 * NOT this card: it is objectui's deliberately-declared back-compat vocabulary
 * (`@object-ui/types` declares it on its own face) and its migration to the
 * spec-canonical keys is deferred to #2231, which this card's body already
 * lists as "an adjacent pair, not this one". The residual is asserted to be
 * EXACTLY that one key, so it cannot quietly grow — and when #2231 lands and it
 * empties, this pin reddens and gets updated deliberately.
 *
 * ⚠️ Requires `@objectstack/spec >= 17.3.0` (the release that adopted the
 * three). That is now also what `@object-ui/core` DECLARES: objectui#9012
 * measured the refusal against every published 17.x and raised the
 * `dependencies` floor from `^17.2.0` to `^17.3.0`, so a resolution this
 * package admits can no longer land on a spec that refuses the fold. The
 * standing instruction that used to live here — "if this file ever reddens on a
 * resolved 17.2.x, the reading is that the declared floor is too low, not that
 * the fold regressed" — has been DISCHARGED, not deleted: it was read exactly
 * that way. The declared floor itself is pinned by
 * `normalize-list-view.declaredSpecFloor-9012.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ListViewSchema as SpecListViewSchema, UserActionsConfigSchema } from '@objectstack/spec/ui';
import { normalizeListViewSchema } from '../normalize-list-view.js';

/** Unrecognized-key names a zod result refuses, flattened. */
const refusedKeys = (r: { error?: { issues?: readonly unknown[] } }): string[] =>
  ((r.error?.issues ?? []) as { code?: string; keys?: string[] }[])
    .filter((i) => i.code === 'unrecognized_keys')
    .flatMap((i) => i.keys ?? []);

const issueCount = (r: { error?: { issues?: readonly unknown[] } }): number =>
  (r.error?.issues ?? []).length;

/**
 * A list view spelled entirely in objectui's LEGACY toolbar vocabulary — all
 * seven `show*` flags at once, which is the widest `userActions` block the fold
 * can produce. The two polarities are both present on purpose: `showGroup:
 * false` (an author turning a default-ON control off) and `showHideFields` /
 * `showColor: true` (an author opting in to a default-OFF one).
 */
const LEGACY_VIEW = {
  name: 'my_view',
  label: 'My View',
  type: 'grid',
  columns: [{ field: 'name' }],
  showSearch: true,
  showSort: true,
  showFilters: true,
  showDensity: true,
  showGroup: false,
  showHideFields: true,
  showColor: true,
} as const;

/** The three keys this card is about. */
const ADOPTED_KEYS = ['group', 'hideFields', 'rowColor'] as const;

describe('the fold`s output is authorable (objectui#5435)', () => {
  beforeEach(() => {
    // #8372's undrawable-kind warning is developer-facing noise here.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('the populations, sized before they are used', () => {
    it('reads a non-empty spec vocabulary that contains all three adopted keys', () => {
      const specKeys = Object.keys(UserActionsConfigSchema.shape).sort();

      expect(specKeys.length).toBe(11);
      expect(specKeys).toEqual([
        'addRecordForm', 'buttons', 'editInline', 'filter', 'group', 'hideFields',
        'refresh', 'rowColor', 'rowHeight', 'search', 'sort',
      ]);

      // The card's whole subject: these were absent at 17.0.0.
      for (const key of ADOPTED_KEYS) expect(specKeys).toContain(key);
    });

    it('folds all seven legacy flags into exactly seven canonical toggles', () => {
      const out = normalizeListViewSchema(LEGACY_VIEW) as Record<string, unknown>;
      const ua = out.userActions as Record<string, unknown>;

      expect(Object.keys(ua).sort()).toEqual([
        'filter', 'group', 'hideFields', 'rowColor', 'rowHeight', 'search', 'sort',
      ]);
      // The author's intent survives the fold, both polarities.
      expect(ua).toEqual({
        search: true, sort: true, filter: true, rowHeight: true,
        group: false, hideFields: true, rowColor: true,
      });
    });
  });

  describe('⭐ the executed parse — the reading the card was missing', () => {
    it('accepts the `userActions` block the fold emits, with zero issues', () => {
      const out = normalizeListViewSchema(LEGACY_VIEW) as Record<string, unknown>;
      const result = UserActionsConfigSchema.safeParse(out.userActions);

      expect(result.success).toBe(true);
      expect(refusedKeys(result)).toEqual([]);
      expect(issueCount(result)).toBe(0);
    });

    it('accepts each adopted key on a whole `ListViewSchema` document', () => {
      for (const key of ADOPTED_KEYS) {
        const result = SpecListViewSchema.safeParse({
          name: 'my_view', label: 'My View', columns: [{ field: 'name' }],
          userActions: { [key]: true },
        });

        expect(result.success, `${key} must be authorable`).toBe(true);
        expect(refusedKeys(result)).toEqual([]);
      }
    });

    it('leaves `viewType` as the ONLY key of the fold`s output the spec refuses', () => {
      const out = normalizeListViewSchema(LEGACY_VIEW) as Record<string, unknown>;
      const result = SpecListViewSchema.safeParse(out);

      // See the SCOPED OUT note above: #2231, not this card. Asserted exactly,
      // so a newly-manufactured refused key cannot hide behind it.
      expect(refusedKeys(result)).toEqual(['viewType']);
      expect(issueCount(result)).toBe(1);

      // With objectui's declared legacy spelling removed, the fold's output is
      // a clean spec document — which is the card's headline, discharged.
      const { viewType: _viewType, ...specSpelled } = out;
      const clean = SpecListViewSchema.safeParse(specSpelled);
      expect(clean.success).toBe(true);
      expect(issueCount(clean)).toBe(0);
    });
  });

  describe('⭐ the firing controls — proof the harness can redden', () => {
    it('still refuses an undeclared key INSIDE `userActions`', () => {
      const out = normalizeListViewSchema(LEGACY_VIEW) as Record<string, unknown>;
      const { viewType: _viewType, ...specSpelled } = out;
      const result = SpecListViewSchema.safeParse({
        ...specSpelled,
        userActions: { ...(out.userActions as Record<string, unknown>), notARealToggle: true },
      });

      expect(result.success).toBe(false);
      expect(refusedKeys(result)).toEqual(['notARealToggle']);
      expect(issueCount(result)).toBe(1);
    });

    it('still refuses an undeclared key at the TOP level', () => {
      const out = normalizeListViewSchema(LEGACY_VIEW) as Record<string, unknown>;
      const { viewType: _viewType, ...specSpelled } = out;
      const result = SpecListViewSchema.safeParse({ ...specSpelled, notARealViewKey: true });

      expect(result.success).toBe(false);
      expect(refusedKeys(result)).toEqual(['notARealViewKey']);
      expect(issueCount(result)).toBe(1);
    });
  });

  describe('the ON/OFF default asymmetry the spec copied from the renderer', () => {
    it('matches the polarity `ListView.tsx` reads the three toggles with', () => {
      const defaults = UserActionsConfigSchema.parse({});

      // `showGroup: ua?.group !== false`      — default ON
      expect(defaults.group).toBe(true);
      // `showHideFields: ua?.hideFields === true` — default OFF (opt-in)
      expect(defaults.hideFields).toBe(false);
      // `showColor: ua?.rowColor === true`    — default OFF (opt-in)
      expect(defaults.rowColor).toBe(false);
    });
  });
});

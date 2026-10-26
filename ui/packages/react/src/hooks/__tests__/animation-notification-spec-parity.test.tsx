/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Animation / notification / navigation ↔ spec vocabulary parity (#2942).
 *
 * Four hyphen-vs-underscore (and coverage) drifts lived in this package:
 *
 * - `useAnimation`'s preset map was keyed in hyphens while the spec enum uses
 *   underscores, and `rotate`/`flip` were absent — 6 of 9 spec presets looked
 *   up NOTHING and rendered no animation;
 * - its easing map had the same split, and the `EASING_MAP[easing] || easing`
 *   fallthrough emitted `animationTimingFunction: 'ease_in_out'` — invalid
 *   CSS the browser silently dropped;
 * - `NotificationContext` carried a `modal` dialect, missed `alert`/`inline`,
 *   and keyed positions in hyphens — all under comments claiming alignment;
 * - `useNavigationOverlay` read only the deprecated `width`, so an authored
 *   `size` bucket was ignored by every host except app-shell.
 *
 * ## Three of the five spec anchors are gone (17.0.0-rc.3)
 *
 * `TransitionPresetSchema` and `EasingFunctionSchema` left with the whole
 * `ui/animation` module (objectstack#4988, PR objectstack#5321), and
 * `NotificationActionSchema` with objectstack#5015 (PR objectstack#5300) —
 * published `ui` vocabulary with NO AUTHORING DOOR in every case. objectui#3363
 * and objectui#3362 both pre-declared this file as one that would go red on the
 * dependency refresh that brought them in.
 *
 * The two-way parity assertions for those three cannot survive: parity needs
 * two sides. What CAN survive — and is what actually protected the #2942 bugs —
 * is the render half: every supported preset must produce classes, and every
 * supported easing must produce valid CSS rather than leaking a raw underscore
 * token. Those loops are re-pointed at the local `SUPPORTED_*` sets, which are
 * the vocabulary's owner now. The two notification enums the spec KEPT
 * (`NotificationTypeSchema` / `NotificationPositionSchema`) still carry their
 * full two-way parity, and that half is deliberately untouched.
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { NotificationTypeSchema, NotificationPositionSchema } from '@objectstack/spec/ui';
import { enumOptions } from '@object-ui/test-support';
import {
  useAnimation,
  SUPPORTED_TRANSITION_PRESETS,
  SUPPORTED_EASING_FUNCTIONS,
} from '../useAnimation';
import { resolveOverlayWidth } from '../useNavigationOverlay';
import {
  SUPPORTED_NOTIFICATION_ACTION_VARIANTS,
  SUPPORTED_NOTIFICATION_DISPLAY_TYPES,
  SUPPORTED_NOTIFICATION_POSITIONS,
} from '../../context/NotificationContext';

function assertParity(specNames: string[], implemented: ReadonlySet<string>, what: string) {
  expect(specNames, `could not read the ${what} enum from the spec`).not.toEqual([]);
  expect(
    specNames.filter((name) => !implemented.has(name)),
    `spec ${what} values with no implementation`,
  ).toEqual([]);
  expect(
    [...implemented].filter((name) => !specNames.includes(name)),
    `renderer-local ${what} dialect — promote into @objectstack/spec instead`,
  ).toEqual([]);
}

describe('react hooks cover the spec animation/notification vocabularies', () => {
  // The `TransitionPresetSchema` / `EasingFunctionSchema` two-way parity tests
  // are REMOVED, not re-pointed at the local set: comparing `SUPPORTED_*`
  // against itself is a tautology that would report green forever. The vocabulary
  // is pinned by content instead, so it cannot drift silently now that no schema
  // enumerates it, and the render loops below are what keep it honest.
  it('the animation vocabulary is pinned by content (objectstack#4988)', () => {
    expect([...SUPPORTED_TRANSITION_PRESETS].sort()).toEqual([
      'fade', 'flip', 'none', 'rotate', 'scale',
      'slide_down', 'slide_left', 'slide_right', 'slide_up',
    ]);
    expect([...SUPPORTED_EASING_FUNCTIONS].sort()).toEqual([
      'ease', 'ease_in', 'ease_in_out', 'ease_out', 'linear', 'spring',
    ]);
  });

  it('notification display types match NotificationTypeSchema both ways', () => {
    assertParity(enumOptions(NotificationTypeSchema), SUPPORTED_NOTIFICATION_DISPLAY_TYPES, 'notification display type');
  });

  it('notification positions match NotificationPositionSchema both ways', () => {
    assertParity(enumOptions(NotificationPositionSchema), SUPPORTED_NOTIFICATION_POSITIONS, 'notification position');
  });

  // `NotificationActionButton.variant` was the shadcn Button vocabulary
  // (`default | destructive | outline`) under a spec-shaped name — a fork of
  // `NotificationActionSchema.variant`, and the one notification vocabulary
  // this guard did not cover. objectstack#5015 (PR objectstack#5300) then
  // retired `NotificationActionSchema` outright: no notification action was
  // ever parsed from metadata, so nothing ran to regress.
  //
  // `NotificationActionButton` is objectui's OWN interface and still exists, so
  // its vocabulary is pinned by content here — the same disposition as the two
  // animation enums above, and for the same reason (objectui#3362).
  it('notification action variants are pinned by content (objectstack#5015)', () => {
    expect([...SUPPORTED_NOTIFICATION_ACTION_VARIANTS].sort()).toEqual([
      'link', 'primary', 'secondary',
    ]);
  });
});

describe('useAnimation renders every supported preset and easing', () => {
  it('every supported preset except none resolves to non-empty classes', () => {
    for (const preset of SUPPORTED_TRANSITION_PRESETS) {
      const { result } = renderHook(() => useAnimation({ preset: preset as never }));
      if (preset === 'none') {
        expect(result.current.className).toBe('');
      } else {
        expect(result.current.className, `preset '${preset}' must animate`).not.toBe('');
      }
    }
  });

  it('every supported easing resolves to valid CSS (never the raw underscore token)', () => {
    for (const easing of SUPPORTED_EASING_FUNCTIONS) {
      const { result } = renderHook(() => useAnimation({ preset: 'fade', easing: easing as never }));
      const value = result.current.style.animationTimingFunction;
      expect(value, `easing '${easing}' must map to CSS`).toBeTruthy();
      expect(String(value), `easing '${easing}' leaked an invalid raw token`).not.toContain('_');
    }
  });

  it('legacy hyphen spellings keep animating (stored-config compatibility)', () => {
    const { result } = renderHook(() =>
      useAnimation({ preset: 'slide-up' as never, easing: 'ease-in-out' as never }),
    );
    expect(result.current.className).toContain('slide-in-from-bottom');
    expect(result.current.style.animationTimingFunction).toBe('ease-in-out');
  });

  it('an out-of-vocabulary easing is dropped rather than emitted as invalid CSS', () => {
    const { result } = renderHook(() => useAnimation({ preset: 'fade', easing: 'bouncy_town' as never }));
    expect(result.current.style.animationTimingFunction).toBeUndefined();
  });

  it('raw CSS timing functions still pass through', () => {
    const { result } = renderHook(() =>
      useAnimation({ preset: 'fade', easing: 'cubic-bezier(0.1, 0.2, 0.3, 0.4)' as never }),
    );
    expect(result.current.style.animationTimingFunction).toBe('cubic-bezier(0.1, 0.2, 0.3, 0.4)');
  });
});

describe('useNavigationOverlay honors the spec size buckets', () => {
  it('every explicit bucket resolves to a viewport-clamped width', () => {
    for (const size of ['sm', 'md', 'lg', 'xl', 'full'] as const) {
      const width = resolveOverlayWidth({ mode: 'drawer', size });
      expect(width, `size '${size}' must resolve a width`).toMatch(/^min\(92vw, \d+px\)$/);
    }
  });

  it("an explicit width wins over the bucket; 'auto' stays host-derived", () => {
    expect(resolveOverlayWidth({ mode: 'drawer', size: 'xl', width: 500 })).toBe(500);
    expect(resolveOverlayWidth({ mode: 'drawer', size: 'auto' })).toBeUndefined();
    expect(resolveOverlayWidth({ mode: 'drawer' })).toBeUndefined();
  });
});

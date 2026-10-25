/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9251 — the `icons` record is off the eager path, and what that cost.
 *
 * The ruling (decision batch #132 item 4, maintainer 「同意」, 2026-09-13) moved
 * the seam's glyph loading onto lucide's dynamic-import map and its membership
 * question onto a build-generated static list. Two things therefore have to be
 * pinned, and they pull in opposite directions:
 *
 *   1. The BYTES actually leave — nothing on the seam's import graph reaches
 *      lucide's runtime `icons` record any more. That half is mechanical, in
 *      `scripts/check-lucide-icon-record-names.mjs` part 4, and re-asserted from
 *      the test side in `lucide-record-icon-names-generated-9251.test.ts`.
 *   2. What renders does NOT change, apart from when the path data arrives.
 *      That is this file.
 *
 * ⚠️ The second is the one a reader will doubt, because "lazy" usually means
 * "renders nothing for a frame". It does not here: which icon a name resolves
 * to is known synchronously from the generated list, so the `<svg>` — its
 * classes, its box, its attributes — is emitted on the first frame and only the
 * `<path>` children arrive late. The rows below assert both halves of that
 * against lucide's OWN component as the oracle, never against a copy of what
 * this repo happens to emit.
 */

import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { icons } from 'lucide-react';

import { resolveIcon } from '../resolve-icon';

/** Render a component to a detached container and hand back its root `<svg>`. */
function renderIcon(Component: React.ElementType, props: Record<string, unknown> = {}) {
  const { container } = render(React.createElement(Component, props));
  return container.querySelector('svg');
}

/** Class list as a sorted set, so ORDER is not silently pinned alongside it. */
const classesOf = (svg: Element | null): string[] =>
  (svg?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).sort();

describe('objectui#9251 — the seam draws lazily without moving what renders', () => {
  it('DISCRIMINATES — a live name gives a component and a dead one gives null, both synchronously', () => {
    // The precondition for every row below, and the half of the contract that
    // deliberately did NOT become async: four call sites choose their own
    // fallback off `null` vs not, while they render.
    expect(resolveIcon('house')).not.toBeNull();
    expect(resolveIcon('not-a-real-icon')).toBeNull();
  });

  it('emits the `<svg>` on the FIRST frame, with the caller\'s className on it', () => {
    const Icon = resolveIcon('house')!;
    const svg = renderIcon(Icon, { className: 'h-4 w-4' });
    expect(svg).not.toBeNull();
    expect(classesOf(svg)).toEqual(['h-4', 'lucide', 'lucide-house', 'w-4'].sort());
    // ⭐ The first frame carries no path data — that is the lazy half, stated as
    // a fact rather than left to be inferred from the row below passing.
    expect(svg!.querySelectorAll('path, circle, rect, line, polyline, polygon')).toHaveLength(0);
  });

  it('fills the path data in once the icon module arrives', async () => {
    const Icon = resolveIcon('house')!;
    const { container } = render(React.createElement(Icon, { className: 'h-4 w-4' }));
    await waitFor(() => {
      expect(container.querySelectorAll('svg.lucide-house path').length).toBeGreaterThan(0);
    });
    // The eventual DOM is lucide's own, path for path.
    const reference = render(React.createElement(icons.House, { className: 'h-4 w-4' }));
    const expected = [...reference.container.querySelectorAll('svg path')].map((p) => p.getAttribute('d'));
    const actual = [...container.querySelectorAll('svg path')].map((p) => p.getAttribute('d'));
    expect(expected.length).toBeGreaterThan(0);
    expect(actual).toEqual(expected);
  });

  it('carries lucide\'s own attributes, not a re-invented set', async () => {
    const seam = renderIcon(resolveIcon('house')!, {});
    const reference = renderIcon(icons.House, {});
    for (const attribute of ['viewBox', 'width', 'height', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'aria-hidden']) {
      expect(seam!.getAttribute(attribute), attribute).toBe(reference!.getAttribute(attribute));
    }
    // `size` still reaches lucide's own calculation rather than a hard-coded 24.
    expect(renderIcon(resolveIcon('house')!, { size: 32 })!.getAttribute('width')).toBe('32');
  });

  it('carries lucide\'s CANONICAL per-icon class over the WHOLE record vocabulary', () => {
    // ⚠️ RELAXED under the maintainer's ruling C on objectui#8941 (comment
    // 5750512894, verbatim 「8941 C」). This row USED TO REFUSE any seam glyph
    // whose complete class set differed from lucide's own component's. It NO
    // LONGER DOES, because lucide-react 1.43.0 emits one class per DECLARED
    // ALIAS (`house` renders `lucide-house lucide-home`) and no longer emits the
    // class it used to derive from the key, and the alias list exists only
    // inside each icon module — the modules objectui#9251 made lazy — while the
    // seam has to put its classes on the FIRST frame. The ruling chose the bump
    // over carrying every alias in the eager static name list (option A), and
    // it was taken knowing that it weakens this row. So a seam glyph missing
    // lucide's alias classes, or carrying the key-derived class lucide no longer
    // emits, now passes here.
    //
    // What it still refuses: a seam glyph without `lucide` or without lucide's
    // CANONICAL class, `lucide-<icon name>`, which lucide emits first after the
    // bare `lucide`. That is the class a conversion rule gets wrong silently,
    // because many keys pack digits that lucide splits in the module name
    // (`ArrowDown01` is `lucide-arrow-down-0-1`, never `lucide-arrow-down01`).
    // Every name is still compared against the record's own component — not a
    // sample, and not a copy of the rule.
    const keys = Object.keys(icons);
    expect(keys.length).toBeGreaterThan(1000);
    const mismatches: string[] = [];
    let digitKeysChecked = 0;
    for (const key of keys) {
      if (/\d/.test(key)) digitKeysChecked += 1;
      const reference = renderIcon((icons as Record<string, React.ElementType>)[key], {});
      const seam = renderIcon(resolveIcon(key)!, {});
      // Read in lucide's own order: `lucide`, then the canonical class, then
      // one class per alias. Only the first two are required of the seam.
      const [base, canonical] = (reference?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
      const got = classesOf(seam);
      if (base !== 'lucide' || !canonical?.startsWith('lucide-') || !got.includes(base) || !got.includes(canonical)) {
        mismatches.push(`${key}: expected "${base} ${canonical}" among "${got.join(' ')}"`);
      }
    }
    expect(mismatches.slice(0, 10)).toEqual([]);
    // Non-vacuity, both ways: the loop ran, and it ran over the class of name
    // this row exists for.
    expect(digitKeysChecked).toBeGreaterThan(50);
  });

  it('returns ONE stable component per name', () => {
    // Several call sites disable `react-hooks/static-components` on the promise
    // that this seam hands back a stable component. A fresh identity per call
    // would remount the glyph on every parent render, so it would re-enter the
    // empty state and never settle.
    expect(resolveIcon('house')).toBe(resolveIcon('house'));
    expect(resolveIcon('Home')).toBe(resolveIcon('house'));
    expect(resolveIcon('house')).not.toBe(resolveIcon('file-text'));
  });
});

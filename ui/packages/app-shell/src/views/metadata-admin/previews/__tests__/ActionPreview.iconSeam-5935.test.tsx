// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#5935 — `ActionPreview` takes the shared seam and KEEPS its name chip.
 *
 * ## Why this file's rows read differently from the other four surfaces'
 *
 * This site's own normalisation was `split(/[-_\s]+/)` plus the `Home -> House`
 * rename — i.e. it was ALREADY the rule the pre-dispatch enumeration went on to
 * measure as the zero-regression one (comment 5522254814). The seam adopted
 * this site's width rather than the `split('-')` the other five used.
 *
 * ⇒ There is NO behavioural row here that could be red before the change, and
 * this file does not pretend otherwise. Its discriminating row is STRUCTURAL:
 * the seam is SPIED, and before the consolidation this renderer never called it
 * — the spy recorded zero calls. That row pins the only thing that actually
 * moved at this site: which function the glyph came out of.
 *
 * Every other row is green in both worlds by construction, which is the point:
 * the acceptance criterion for this card is that nothing observable changed on
 * the fallback behaviours, and the fourth of the tree's four is this chip.
 *
 * ## Why the module is SPIED rather than stubbed
 *
 * `importOriginal` keeps the REAL resolver running against the REAL lucide
 * record, so the behaviour rows still test resolution rather than a fixture. A
 * stub returning a fixed component would have deleted the half that matters —
 * that an unresolvable name yields the chip and not a wrong glyph.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/components')>();
  return { ...actual, resolveIcon: vi.fn(actual.resolveIcon) };
});

import { resolveIcon } from '@object-ui/components';
import { ActionPreview } from '../ActionPreview';

const seam = vi.mocked(resolveIcon);

beforeEach(() => seam.mockClear());
afterEach(cleanup);

function renderPreview(icon: string) {
  return render(
    <ActionPreview
      type="action"
      name="new_task"
      draft={{ name: 'new_task', label: 'New Task', type: 'script', target: 'true', icon }}
    />,
  );
}

describe('ActionPreview icon binding (objectui#5935)', () => {
  it('CONTROL — the preview renders its action, whatever the icon does', () => {
    // Without this, every "the chip is shown" row below could pass against a
    // preview that fell into an error boundary and drew nothing at all.
    renderPreview('definitely-not-a-lucide-icon');
    expect(screen.getAllByText('New Task').length).toBeGreaterThan(0);
  });

  describe('routing — the only row here that discriminates', () => {
    it('resolves the authored name through the SHARED seam', () => {
      // RED before the consolidation: this file carried its own tokeniser and
      // rename ternary and never called this function.
      renderPreview('file-text');
      expect(seam).toHaveBeenCalledWith('file-text');
    });

    it('draws the glyph the seam returned, not one of its own', () => {
      // ⚠️ `toHaveBeenCalled` FIRST. Reading `mock.results[0]?.value` straight
      // away is a BLIND instrument — with zero calls it is `undefined`, and
      // `expect(undefined).not.toBeNull()` passes.
      const { container } = renderPreview('file-text');
      expect(seam).toHaveBeenCalled();
      expect(seam.mock.results[0].value).not.toBeNull();
      expect(container.querySelector('svg.lucide-file-text')).not.toBeNull();
    });
  });

  describe('the name chip — GREEN IN BOTH WORLDS, pinning that nothing moved', () => {
    it('falls back to the 3-character chip when the name does not resolve', () => {
      // ⭐ The fourth of the tree's four unresolvable behaviours, and the one
      // that killed the 2026-08-31 `onUnresolvable: "placeholder" | "null"`
      // domain: it is neither. The chip stays HERE (maintainer ruling
      // 2026-09-03, comment 5523286738, option C) so an author can still see
      // that an icon binding is in place.
      const { container } = renderPreview('definitely-not-a-lucide-icon');
      expect(container.querySelector('svg.lucide-definitely-not-a-lucide-icon')).toBeNull();
      // Positive: the chip is the first three characters, uppercased by CSS but
      // authored verbatim in the DOM.
      expect(screen.getAllByText('def').length).toBeGreaterThan(0);
    });

    it('shows no chip when the name DOES resolve', () => {
      // The control that makes the row above a reading: the chip is not simply
      // always present.
      renderPreview('file-text');
      expect(screen.queryByText('fil')).toBeNull();
    });

    it('keeps resolving the spellings this site already accepted', () => {
      // Green in both worlds, and load-bearing: the shared tokeniser had to
      // ADOPT this site's width. A narrowing to `split('-')` would land here
      // first, and it is the regression the enumeration measured at 4,748
      // name-surface pairs.
      expect(renderPreview('file_text').container.querySelector('svg.lucide-file-text')).not.toBeNull();
      cleanup();
      expect(renderPreview('file text').container.querySelector('svg.lucide-file-text')).not.toBeNull();
      cleanup();
      expect(renderPreview('home').container.querySelector('svg.lucide-house')).not.toBeNull();
    });
  });
});

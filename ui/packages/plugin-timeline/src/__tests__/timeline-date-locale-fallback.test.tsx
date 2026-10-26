/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4513 — the timeline's date sites with NO provider mounted.
 *
 * ── Why this is a separate file (objectui#4514) ──────────────────────────
 * Nothing here mounts an `I18nProvider`, and that is load-bearing rather than
 * incidental. `useObjectTranslation()` outside a provider reports the language
 * of react-i18next's GLOBAL instance, and every `I18nProvider` mounted in a
 * file leaves that global on whatever language it was given. A provider-less
 * assertion written after a `zh` case in the same file therefore resolves
 * `'zh'` — a fact about test ordering, not about the fallback. The session
 * cases live in `timeline-date-locale.test.tsx`; these stay alone.
 *
 * ── What this pins, and what it deliberately cannot ──────────────────────
 * `useDisplayLocale()`'s third step is a concrete `'en'`, never `undefined`.
 * That matters because `undefined` is what `Intl` reads as "the MACHINE's
 * locale" — the exact defect at `renderer.tsx:157` before this change, where a
 * bare `toLocaleDateString()` made an embedded timeline render in whatever
 * locale the viewer's machine happened to be set to.
 *
 * ⚠️ These cases are green on BOTH sides of the fix on an en-US runner, by
 * construction: `'en'` and the machine's `en-US` agree on all of these forms,
 * which is precisely why the old code could ship looking correct. They are a
 * must-not-change pin, NOT the red-first evidence — the red-first half is the
 * `zh session` block in the sibling file, which is the only place the machine
 * locale and the session locale disagree. Spelled `'en'` explicitly rather
 * than as a bare `toLocale*` call computed here, so the expectation does not
 * silently follow the runner the way the code under test used to.
 */

import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TimelineRenderer, generateTimeScaleHeaders } from '../renderer';

const AUG_11 = '2026-08-11T00:00:00';
const SEP_11 = '2026-09-11T00:00:00';

describe('no provider mounted — the resolver’s last resort is a concrete `en`', () => {
  it('the item date renders `en`, not the machine locale', () => {
    const schema = {
      type: 'timeline',
      variant: 'vertical',
      dateFormat: 'long',
      items: [{ time: AUG_11, title: 'Beta Release' }],
    } as any;
    const { container } = render(<TimelineRenderer schema={schema} />);
    expect(container.textContent).toContain(
      new Date(AUG_11).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' }),
    );
  });

  it('the gantt axis renders `en`', () => {
    const schema = {
      type: 'timeline',
      variant: 'gantt',
      scale: 'month',
      minDate: AUG_11,
      maxDate: SEP_11,
      items: [{ label: 'Backend', items: [{ title: 'API Design', startDate: AUG_11, endDate: SEP_11 }] }],
    } as any;
    const { container } = render(<TimelineRenderer schema={schema} />);
    expect(container.textContent).toContain('Aug 2026');
  });
});

describe('generateTimeScaleHeaders — the exported helper called without a locale', () => {
  /**
   * The helper is exported (the spec-parity test drives it directly), so its
   * locale parameter is optional and defaults to `'en'` — the same concrete
   * last resort the hook resolves to, so an existing 3-argument call site
   * keeps producing exactly what the retired `'en-US'` literal produced.
   *
   * This is a pure function with no React in it, so unlike the renders above
   * it is not sensitive to provider state at all — it is safe in any file.
   */
  it('defaults to `en`, byte-identical to the retired `en-US` literal', () => {
    expect(generateTimeScaleHeaders('month', AUG_11, SEP_11)).toEqual(['Aug 2026', 'Sep 2026']);
    expect(generateTimeScaleHeaders('day', AUG_11, '2026-08-12T00:00:00')).toEqual(['Aug 11', 'Aug 12']);
    expect(generateTimeScaleHeaders('hour', '2026-08-11T09:00:00', '2026-08-11T10:00:00')).toEqual([
      'Aug 11, 9 AM',
      'Aug 11, 10 AM',
    ]);
  });

  it('honours an explicit locale when one is passed', () => {
    expect(generateTimeScaleHeaders('month', AUG_11, SEP_11, 'zh')).toEqual(['2026年8月', '2026年9月']);
  });
});

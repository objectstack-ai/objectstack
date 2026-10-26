/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The percent cell's progress bar is named by the value beside it
 * (objectui#11690).
 *
 * axe (wcag2a + wcag2aa) on a stock task list measured `aria-progressbar-name`
 * once per row with a `progress` column: the bar carried `role="progressbar"`
 * and its value attributes, and no name. It now takes its name from the
 * formatted value span (`aria-labelledby`), the one string the cell already
 * renders in the viewer's locale — so the pin reads the name in a non-English
 * locale and compares it to that span, never to a literal.
 *
 * `color-contrast` is off: it needs layout happy-dom does not compute, and it
 * is outside the card.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import axe from 'axe-core';
import { I18nProvider } from '@object-ui/i18n';
import { PercentCellRenderer } from '../index';

afterEach(cleanup);

function renderCell(value: unknown, field: Record<string, unknown>, language = 'en') {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <PercentCellRenderer value={value as any} field={{ type: 'percent', ...field } as any} />
    </I18nProvider>,
  );
}

describe('PercentCellRenderer names its progress bar (objectui#11690)', () => {
  it.each([
    ['a fraction-stored percent', 0.42, { name: 'win_rate' }],
    ['a whole-point `progress`', 75, { name: 'progress', type: 'progress', min: 0, max: 100 }],
  ] as const)('%s: no wcag2a/aa violation, and the progressbar rule really ran', async (_shape, value, field) => {
    const { container } = renderCell(value, field);
    const res = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(res.violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.html) }))).toEqual([]);
    // Control: a zero above is a reading only if the rule found the bar to judge.
    expect(res.passes.map((p) => p.id)).toContain('aria-progressbar-name');
  });

  it('the name is the formatted value the cell shows, in the viewer\'s locale', () => {
    renderCell(1234.5, { name: 'win_rate', max: 10000 }, 'de');
    const bar = screen.getByRole('progressbar');
    const shown = bar.parentElement!.querySelector('span')!.textContent!;
    // de writes `1.235 %` — a non-English face, so an English literal cannot pass.
    expect(shown).toMatch(/^1\.235\s%$/u);
    expect(bar).toHaveAccessibleName(shown);
  });

  it('two cells on one page name their bars apart', () => {
    render(
      <div>
        <PercentCellRenderer value={0.1 as any} field={{ type: 'percent', name: 'a' } as any} />
        <PercentCellRenderer value={0.9 as any} field={{ type: 'percent', name: 'b' } as any} />
      </div>,
    );
    const names = screen.getAllByRole('progressbar').map((bar) => bar.getAttribute('aria-labelledby'));
    expect(new Set(names).size).toBe(2);
  });
});

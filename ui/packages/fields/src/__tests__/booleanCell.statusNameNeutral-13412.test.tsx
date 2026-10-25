/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13412 — a boolean renders the same whatever its name.
 *
 * `BooleanCellRenderer` drew a destructive "LABEL — Off" badge for `false`
 * when the field was named `active`, `is_active`, `enabled`, `is_enabled`,
 * `verified` or `is_verified`. Any other boolean drew an unchecked box. So a
 * plain `Field.boolean` named `verified` with `defaultValue: false` read as a
 * red error ("已核验 — 已关闭" under zh) on every new record, in the list and on
 * the record page. Nothing in the metadata asked for that face and nothing
 * could turn it off.
 *
 * The pin: every one of those names holding a real `false` draws the plain
 * unchecked box, named by its field, with no `boolean-warning-badge` and no
 * destructive colour. The control: the same names holding `true` still draw
 * the checked box. A renderer that drew nothing, or drew the box only for
 * `true`, fails the `false` legs by failure mode, not just by count.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { getCellRenderer, resolveCellRendererType } from '../index';

afterEach(() => cleanup());

/** Resolve + render exactly the way a consumer builds a read-mode cell. */
function renderCell(type: string, value: unknown, field: Record<string, unknown>) {
  const Renderer = getCellRenderer(resolveCellRendererType({ type }) || type);
  return render(<Renderer value={value} field={{ type, ...field } as never} />);
}

/** The names the retired heuristic matched, as the card's `verified` first. */
const STATUS_LIKE_NAMES = ['verified', 'is_verified', 'active', 'is_active', 'enabled', 'is_enabled'] as const;

const badge = (root: HTMLElement) => root.querySelector('[data-testid="boolean-warning-badge"]');
const destructive = (root: HTMLElement) => root.querySelector('[class*="destructive"]');

describe('objectui#13412 — a false on a status-like name is the neutral unchecked box', () => {
  for (const type of ['boolean', 'toggle'] as const) {
    describe(`\`${type}\``, () => {
      for (const name of STATUS_LIKE_NAMES) {
        it(`\`${name}\` holding false draws an unchecked box and no warning badge`, () => {
          const { container } = renderCell(type, false, { name, label: 'Verified' });
          expect(badge(container), `${name}: false must draw no boolean-warning-badge`).toBeNull();
          expect(destructive(container), `${name}: false must draw no destructive colour`).toBeNull();
          const box = screen.getByRole('checkbox', { name: 'Verified' });
          expect(box, `${name}: false must be an unchecked box`).not.toBeChecked();
        });

        it(`CONTROL — \`${name}\` holding true still draws the checked box`, () => {
          const { container } = renderCell(type, true, { name, label: 'Verified' });
          expect(screen.getByRole('checkbox', { name: 'Verified' })).toBeChecked();
          expect(badge(container)).toBeNull();
        });
      }
    });
  }

  it('the card\'s pair: `verified` and `is_mandatory` holding false draw the same face', () => {
    const verified = renderCell('boolean', false, { name: 'verified', label: 'L' }).container.innerHTML;
    cleanup();
    const mandatory = renderCell('boolean', false, { name: 'is_mandatory', label: 'L' }).container.innerHTML;
    expect(verified).toBe(mandatory);
  });
});

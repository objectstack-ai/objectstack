/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The highlights strip draws a boolean neutrally (objectstack#27434, row 4).
 *
 * The strip coloured `true` as a green "✓ Yes" and `false` as a warning-toned
 * "× No", whatever the field means, so a case's "SLA Violated: No" wore the
 * warning colour. The metadata does not say which value is the good one, and
 * the details body draws the same field as a plain word, so the strip's chip
 * is one neutral face for both values: the same classes, no state colour, no
 * glyph.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as React from 'react';
import { HeaderHighlight } from '../HeaderHighlight';

afterEach(cleanup);

const objectSchema = {
  fields: {
    subject: { type: 'text', label: 'Subject' },
    is_sla_violated: { type: 'boolean', label: 'SLA Violated' },
    is_escalated: { type: 'boolean', label: 'Escalated' },
  },
};

function renderStrip() {
  render(
    <HeaderHighlight
      fields={
        [
          { name: 'subject', label: 'Subject' },
          { name: 'is_sla_violated', label: 'SLA Violated' },
          { name: 'is_escalated', label: 'Escalated' },
        ] as any
      }
      data={{ subject: 'Login fails', is_sla_violated: false, is_escalated: true }}
      objectSchema={objectSchema}
    />,
  );
}

/** The chip drawn in a column, anchored on the field LABEL. */
const chipOf = (label: string) => {
  const column = screen.getByText(label).parentElement as HTMLElement;
  const chip = column.querySelector('[data-boolean-chip]');
  expect(chip, `a boolean chip under "${label}"`).not.toBeNull();
  return chip as HTMLElement;
};

const STATE_COLOUR = /\b(?:bg|text|ring)-(?:emerald|green|amber|red|yellow|orange|destructive|success|warning)\b/;

describe('the highlights strip draws a boolean neutrally (objectstack#27434)', () => {
  it('`false` wears no warning colour and `true` no success colour', () => {
    renderStrip();
    for (const label of ['SLA Violated', 'Escalated']) {
      const chip = chipOf(label);
      expect(chip.className).not.toMatch(STATE_COLOUR);
      expect(chip.querySelector('svg')).toBeNull();
    }
  });

  it('both values share one face: only the word differs', () => {
    renderStrip();
    const no = chipOf('SLA Violated');
    const yes = chipOf('Escalated');
    expect(no.className).toBe(yes.className);
    expect(no.textContent).toBe('No');
    expect(yes.textContent).toBe('Yes');
  });

  it('CONTROL: the strip drew its non-boolean value too', () => {
    renderStrip();
    expect(screen.getByText('Login fails')).toBeTruthy();
  });
});

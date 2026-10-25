/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every settings control is named by its row's label (objectui#11690).
 *
 * axe (wcag2a + wcag2aa) on Setup → Settings → Authentication measured `label`
 * on every text / number / password / textarea input and `button-name` on
 * every switch and select trigger: the row drew a `<Label>` with no `htmlFor`,
 * so the words sat beside the control and named nothing. The two counts are
 * the page's input rows and its toggle + select rows.
 *
 * Pinned per specifier type, derived from one table so a type added to it is
 * judged by both halves: axe finds nothing over the whole set, AND each
 * control's accessible name IS its row's label — the second half is what the
 * first cannot say on its own (a control named by the wrong row passes axe).
 *
 * `color-contrast` is off: it needs layout happy-dom does not compute, and it
 * is outside the card.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import axe from 'axe-core';
import { SettingsField } from '../SettingsField';
import type { Specifier } from '../types';

afterEach(cleanup);

const OPTIONS = [
  { value: 'x', label: 'Ex' },
  { value: 'y', label: 'Why' },
];

/** One specifier per input type, labelled after its type so a mix-up shows. */
const SPECS: Specifier[] = [
  { type: 'text', key: 'k_text', label: 'Label text' },
  { type: 'email', key: 'k_email', label: 'Label email' },
  { type: 'url', key: 'k_url', label: 'Label url' },
  { type: 'phone', key: 'k_phone', label: 'Label phone' },
  { type: 'password', key: 'k_password', label: 'Label password' },
  { type: 'textarea', key: 'k_textarea', label: 'Label textarea' },
  { type: 'number', key: 'k_number', label: 'Label number' },
  { type: 'json', key: 'k_json', label: 'Label json' },
  { type: 'toggle', key: 'k_toggle', label: 'Label toggle' },
  { type: 'select', key: 'k_select', label: 'Label select', options: OPTIONS },
  { type: 'select', key: 'k_domain', label: 'Label domain', valueDomain: 'iana_time_zone', options: OPTIONS },
  { type: 'radio', key: 'k_radio', label: 'Label radio', options: OPTIONS },
  { type: 'multiselect', key: 'k_multi', label: 'Label multiselect', options: OPTIONS },
  { type: 'color', key: 'k_color', label: 'Label color' },
] as Specifier[];

function renderAll() {
  return render(
    <div>
      {SPECS.map((spec) => (
        <SettingsField key={spec.key} spec={spec} value={undefined} onChange={() => {}} />
      ))}
    </div>,
  );
}

describe('SettingsField binds its label to its control (objectui#11690)', () => {
  it('axe finds no wcag2a/aa violation over every input type, and the name rules really ran', async () => {
    const { container } = renderAll();
    const res = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(res.violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.html) }))).toEqual([]);
    // Control: a zero above is a reading only if the rules found nodes to judge.
    expect(res.passes.map((p) => p.id)).toEqual(expect.arrayContaining(['label', 'button-name']));
  });

  it.each(
    SPECS.filter((s) => !['radio', 'multiselect'].includes(s.type)).map((s) => [s.type, s.label as string] as const),
  )('%s: the control is found by its row label', (_type, label) => {
    renderAll();
    // `getAllByLabelText`: the colour row names two controls, the swatch and
    // its hex box; every other row names exactly one.
    const controls = screen.getAllByLabelText(label);
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) expect(control).toHaveAccessibleName(label);
  });

  it.each([
    ['radio', 'radiogroup', 'Label radio'],
    ['multiselect', 'group', 'Label multiselect'],
  ] as const)('%s: the option group is named by its row label', (_type, role, label) => {
    renderAll();
    expect(screen.getByRole(role, { name: label })).toBeInTheDocument();
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11781 — on a read-only package the validation editor's controls
 * look disabled, the way the read-only field inspector's do.
 *
 * Measured in a Studio browser pass on the showcase (read-only): the rule
 * editor's inputs were `disabled` but kept the editable look — white fill,
 * dark text — beside a greyed field inspector. The inspector's inputs are the
 * `@object-ui/components` primitives, whose disabled look is their
 * `disabled:` utilities; this panel's controls are plain elements, so they
 * carried none.
 *
 * The expected look is read off the primitive itself rather than restated
 * here, so this pins "the same look as the inspector's inputs", not a copy of
 * today's class list. Plain checkboxes are out of scope on purpose: they keep
 * the browser's own disabled look, as the inspector's checkboxes do.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Input } from '@object-ui/components';
import { ObjectValidationsPanel } from './ObjectValidationsPanel';

afterEach(cleanup);

/** The `disabled:` utilities the shared Input primitive wears. */
function primitiveDisabledLook(): string[] {
  const { container, unmount } = render(<Input disabled />);
  const tokens = (container.querySelector('input') as HTMLInputElement).className
    .split(/\s+/)
    .filter((c) => c.startsWith('disabled:'));
  unmount();
  return tokens;
}

const fields = {
  status: { type: 'select', label: 'Status' },
  code: { type: 'text', label: 'Code' },
  payload: { type: 'json', label: 'Payload' },
};

/** One rule per type whose editor is built from this panel's own controls. */
const RULES = [
  { type: 'format', name: 'code_format', message: 'Bad code', field: 'code', regex: '^[A-Z]+$', severity: 'error', priority: 1 },
  { type: 'state_machine', name: 'status_flow', message: 'Bad move', field: 'status', transitions: { open: ['closed'] } },
  { type: 'json_schema', name: 'payload_shape', message: 'Bad payload', field: 'payload', schema: { type: 'object' } },
];

/**
 * The panel's text-like controls and its pickers; checkboxes are excluded (see
 * header). The pickers are the shared `Select` since objectui#11865, so a
 * picker is its trigger, the `role="combobox"` button.
 */
function controls(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'input:not([type="checkbox"]), select, textarea, button[role="combobox"]',
    ),
  ];
}

describe('ObjectValidationsPanel — read-only controls look disabled (objectui#11781)', () => {
  it('the shared primitive has a disabled look to match (precondition)', () => {
    expect(primitiveDisabledLook().length).toBeGreaterThan(0);
  });

  it.each(RULES.map((r) => [r.type, r] as const))('%s rule, read-only: every control is disabled and wears it', (_type, rule) => {
    const look = primitiveDisabledLook();
    const { container } = render(
      <ObjectValidationsPanel draft={{ fields, validations: [rule] }} onPatch={() => {}} disabled />,
    );

    const all = controls(container);
    // The common fields alone are six controls; a vacuous pass is not one.
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const el of all) {
      expect(el).toBeDisabled();
      for (const token of look) expect(el, `${el.tagName} lacks ${token}`).toHaveClass(token);
    }
  });

  it('CONTROL — writable: the same controls are enabled', () => {
    const { container } = render(
      <ObjectValidationsPanel draft={{ fields, validations: [RULES[0]] }} onPatch={() => {}} />,
    );

    const all = controls(container);
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const el of all) expect(el).toBeEnabled();
  });
});

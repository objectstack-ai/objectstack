/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One carrier for one question: the widgets read `SchemaRenderer`'s EVALUATED
 * `disabled` verdict, never the raw authored key beside it (objectui#7238,
 * AGENTS.md #0.1; the in-tree precedent is `plugin-chatbot`'s renderer,
 * objectui#6169).
 *
 * `disabled` on a `BaseSchema` node is `boolean | string` — the string being a
 * predicate. `SchemaRenderer` evaluates `disabled` / `disabledOn`, STRIPS the
 * raw key from the props it spreads, and forwards the verdict as a real
 * `disabled` prop (`disabled: __disabled || undefined`). A widget that re-reads
 * `schema.disabled` is reading an expression string, which is truthy however it
 * evaluates.
 *
 * Every case here renders through the REAL `SchemaRenderer` and the real
 * registry, so the verdict path is the one under test. Each predicate is
 * exercised in BOTH polarities against the same node, which is what separates
 * "the widget ignores the verdict" from "the widget is never disabled at all" —
 * a one-polarity pin would go green on a widget that dropped `disabled`
 * entirely.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererContext, PredicateScopeProvider } from '@object-ui/react';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout` (objectui#3010/#3021).
import '../renderers';

/** `${data.locked}` resolves against this — the `dataSource` on the context. */
function renderNode(schema: Record<string, unknown>, locked: boolean) {
  return render(
    <PredicateScopeProvider scope={{ data: { locked } }}>
      <SchemaRendererContext.Provider value={{ dataSource: { locked } } as never}>
      <SchemaRenderer schema={schema as never} />
    </SchemaRendererContext.Provider>
    </PredicateScopeProvider>,
  );
}

/** A predicate string — the shape that is truthy however it evaluates. */
const PREDICATE = '${data.locked}';

/* ────────────────────────────────────────────────────────────────────────────
 * (b) `form` — the raw read that dropped the host verdict entirely
 * ───────────────────────────────────────────────────────────────────────── */

function formSchema() {
  return {
    type: 'form',
    disabled: PREDICATE,
    submitLabel: 'Save',
    showCancel: true,
    cancelLabel: 'Cancel',
    fields: [{ name: 'notes', label: 'Notes', type: 'input' }],
  };
}

describe('`form` consumes the evaluated verdict, not the raw predicate (objectui#7238)', () => {
  it('a FALSE predicate leaves the fields and the action bar interactive', () => {
    renderNode(formSchema(), false);

    expect((screen.getByLabelText(/notes/i) as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('a TRUE predicate still greys the whole form out', () => {
    renderNode(formSchema(), true);

    expect((screen.getByLabelText(/notes/i) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a literal `disabled: true` is unchanged — the verdict says the same thing', () => {
    renderNode({ ...formSchema(), disabled: true }, false);

    expect((screen.getByLabelText(/notes/i) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * (c) `ui:button` — `isDisabled` was computed from the raw key, and then
 * overwritten by the forwarded verdict arriving through the DOM spread. The
 * `loading` leg of that OR was the casualty: it never reached the element.
 * ───────────────────────────────────────────────────────────────────────── */

const button = () => screen.getByRole('button') as HTMLButtonElement;

describe('`ui:button` consumes the evaluated verdict, not the raw predicate (objectui#7238)', () => {
  it('a FALSE predicate leaves the button clickable', () => {
    renderNode({ type: 'button', label: 'Go', disabled: PREDICATE }, false);
    expect(button().disabled).toBe(false);
  });

  it('a TRUE predicate disables it', () => {
    renderNode({ type: 'button', label: 'Go', disabled: PREDICATE }, true);
    expect(button().disabled).toBe(true);
  });

  it('`loading` disables the button — the leg the raw read used to lose', () => {
    // `isDisabled` was `schema.disabled || props.disabled || isLoading`, applied
    // BEFORE the DOM spread that carries the host's `disabled` prop. With no
    // predicate authored the verdict is `undefined`, and `{...toFormControlDomProps(rest)}`
    // re-declared `disabled` — key present, value `undefined` (`pickDomProps`
    // iterates `Object.keys`) — so it overwrote the computed value and the
    // spinner spun on a live button.
    renderNode({ type: 'button', label: 'Go', loading: true }, false);
    expect(button().disabled).toBe(true);
    expect(document.querySelector('svg.animate-spin')).not.toBeNull();
  });

  it('`loading` and a TRUE predicate agree', () => {
    renderNode({ type: 'button', label: 'Go', loading: true, disabled: PREDICATE }, true);
    expect(button().disabled).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * (a) the six DOM pass-throughs. Their runtime was already correct THROUGH the
 * renderer (the forwarded prop was spread after the raw one), so these are the
 * regression guard on removing the raw read: they must not move.
 * ───────────────────────────────────────────────────────────────────────── */

const PASSTHROUGHS: Array<{ type: string; node: Record<string, unknown>; control: () => HTMLElement }> = [
  {
    type: 'input',
    node: { type: 'input', id: 'i1', label: 'Notes' },
    control: () => document.querySelector('input')!,
  },
  {
    type: 'textarea',
    node: { type: 'textarea', id: 't1', label: 'Notes' },
    control: () => document.querySelector('textarea')!,
  },
  {
    type: 'checkbox',
    node: { type: 'checkbox', id: 'c1', label: 'Agree' },
    control: () => document.querySelector('[role="checkbox"]')!,
  },
  {
    type: 'select',
    node: { type: 'select', id: 's1', options: [{ label: 'A', value: 'a' }] },
    control: () => document.querySelector('[role="combobox"]')!,
  },
  {
    type: 'combobox',
    node: { type: 'combobox', id: 'cb1', options: [{ label: 'A', value: 'a' }] },
    control: () => document.querySelector('button')!,
  },
];

describe.each(PASSTHROUGHS)('`$type` consumes the evaluated verdict (objectui#7238)', ({ node, control }) => {
  it('a FALSE predicate leaves the control interactive', () => {
    renderNode({ ...node, disabled: PREDICATE }, false);
    const el = control();
    expect(el).toBeTruthy();
    expect(el.hasAttribute('disabled')).toBe(false);
  });

  it('a TRUE predicate disables the control', () => {
    renderNode({ ...node, disabled: PREDICATE }, true);
    expect(control().hasAttribute('disabled')).toBe(true);
  });

  it('a literal `disabled: true` disables the control', () => {
    renderNode({ ...node, disabled: true }, false);
    expect(control().hasAttribute('disabled')).toBe(true);
  });
});

describe('`collapsible` consumes the evaluated verdict (objectui#7238)', () => {
  const node = {
    type: 'collapsible',
    id: 'col1',
    trigger: [{ type: 'text', content: 'Toggle' }],
    content: [{ type: 'text', content: 'Body' }],
  };
  // Radix's Collapsible root stamps `data-disabled` from the same prop it
  // hands the trigger, so this reads the root's own verdict rather than a
  // nested widget's.
  const root = () => document.querySelector('[data-state]')!;

  it('a FALSE predicate leaves it enabled', () => {
    renderNode({ ...node, disabled: PREDICATE }, false);
    expect(root().hasAttribute('data-disabled')).toBe(false);
  });

  it('a TRUE predicate disables it', () => {
    renderNode({ ...node, disabled: PREDICATE }, true);
    expect(root().hasAttribute('data-disabled')).toBe(true);
  });

  it('a literal `disabled: true` disables it', () => {
    renderNode({ ...node, disabled: true }, false);
    expect(root().hasAttribute('data-disabled')).toBe(true);
  });
});

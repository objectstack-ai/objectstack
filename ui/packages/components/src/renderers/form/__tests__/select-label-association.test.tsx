/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ui:select` — the authored `label` names the combobox (objectui#10435).
 *
 * Pre-fix, the renderer drew its `Label` with no `htmlFor` and the Radix
 * `SelectTrigger` with no `id`, and nothing set `aria-label` /
 * `aria-labelledby`. The trigger is a `button` with `role="combobox"`, a role
 * that takes no name from its content, so neither the placeholder nor the
 * value text named it: a labelled select's combobox had an EMPTY accessible
 * name, and `getByRole('combobox', { name: LABEL })` could not find it.
 *
 * The fix is the `element:record_picker` shape (objectui#5771): the trigger
 * gets `schema.id`, the label gets `htmlFor` to it. So every associated case
 * below authors an `id`, and the no-`id` case pins that the renderer mints
 * none, the same deliberate half that shape pins for the picker.
 *
 * Each case resolves the association end to end (`getByRole` by name,
 * `toHaveAccessibleName`, `label[for]` through `document.getElementById`, the
 * trigger's `labels` collection), never `htmlFor` and `id` read as two
 * independent strings: two values that are each present and never match is the
 * failure mode objectui#3341 documents.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
import { renderComponent } from '../../../__tests__/test-utils';
// Registers `select` at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../../../renderers';
import type { SelectSchema } from '@object-ui/types';

/**
 * Types a literal below as the node it is rather than as the `BaseSchema`
 * `renderComponent` and `SchemaRenderer` accept (objectui#11347): since objectui#8347 removed
 * `BaseSchema`'s index signature, a literal checked against `BaseSchema`
 * may author only `BaseSchema`'s own keys.
 */
const selectNode = (schema: SelectSchema): SelectSchema => schema;

afterEach(cleanup);

const OPTIONS = [
  { label: 'Mr', value: 'mr' },
  { label: 'Ms', value: 'ms' },
];

describe('ui:select — label names the combobox (objectui#10435)', () => {
  it('is found by getByRole combobox with the label as its name', () => {
    renderComponent(selectNode({ type: 'select', id: 'title', label: 'Title', options: OPTIONS }));

    const combobox = screen.getByRole('combobox', { name: 'Title' });
    expect(combobox).toHaveAccessibleName('Title');
    expect(screen.getByLabelText('Title')).toBe(combobox);
  });

  it('keeps the name `Title` when required: the aria-hidden marker stays out of it', () => {
    renderComponent(selectNode({ type: 'select', id: 'title', label: 'Title', required: true, options: OPTIONS }));

    // The marker is still drawn inside the label (objectui#10368) ...
    const label = document.querySelector('label[for="title"]');
    expect(label).not.toBeNull();
    expect(label!.querySelector('[data-required-marker][aria-hidden="true"]')).toHaveTextContent('*');

    // ... and the name the label now gives the combobox excludes it.
    const combobox = screen.getByRole('combobox', { name: 'Title' });
    expect(combobox).toHaveAccessibleName('Title');
    expect(combobox).toHaveAttribute('aria-required', 'true');
  });

  it('points `for` at an id that really exists on the trigger', () => {
    renderComponent(selectNode({ type: 'select', id: 'title', label: 'Title', options: OPTIONS }));

    const label = document.querySelector('label[for]');
    expect(label).not.toBeNull();
    const target = document.getElementById(label!.getAttribute('for')!);
    expect(target).not.toBeNull();
    expect(target).toBe(screen.getByRole('combobox'));

    // The association browsers use for both the name and click-to-focus.
    const trigger = target as HTMLButtonElement;
    expect(Array.from(trigger.labels ?? [])).toEqual([label]);
  });

  it('names the combobox with the label, not the placeholder text inside it', () => {
    renderComponent(selectNode({ type: 'select', id: 'title', label: 'Title', placeholder: 'Choose…', options: OPTIONS }));

    const combobox = screen.getByRole('combobox');
    expect(combobox).toHaveTextContent('Choose…');
    expect(combobox).toHaveAccessibleName('Title');
  });

  it('names the combobox with the label, not the selected value text inside it', () => {
    renderComponent(selectNode({ type: 'select', id: 'title', label: 'Title', value: 'ms', options: OPTIONS }));

    const combobox = screen.getByRole('combobox');
    expect(combobox).toHaveTextContent('Ms');
    expect(combobox).toHaveAccessibleName('Title');
  });

  it('mints no id when `schema.id` is absent: the caption stays unassociated', () => {
    // The deliberate half of the objectui#5771 shape: only the author supplies
    // `schema.id`, so without one the renderer neither writes `for` nor mints
    // an `id`, and the combobox stays unnamed, as before this change. Pinned so
    // a later change to that answer is a visible decision, not a drift.
    renderComponent(selectNode({ type: 'select', label: 'Title', placeholder: 'Choose…', options: OPTIONS }));

    const combobox = screen.getByRole('combobox');
    expect(combobox).toHaveTextContent('Choose…');
    const label = document.querySelector('label');
    expect(label).not.toBeNull();
    expect(label).not.toHaveAttribute('for');
    expect(combobox).not.toHaveAttribute('id');
    expect(combobox).toHaveAccessibleName('');
  });

  it('survives the real render path through SchemaRenderer', () => {
    render(
      <SchemaRenderer
        schema={selectNode({ type: 'select', id: 'title', label: 'Title', required: true, options: OPTIONS })}
      />,
    );

    // By role and name, not `getByLabelText('Title')`: that query matches the
    // label's whole text content, which on a required field includes the
    // aria-hidden `*` the accessible name leaves out.
    const combobox = screen.getByRole('combobox', { name: 'Title' }) as HTMLButtonElement;
    expect(Array.from(combobox.labels ?? [])).toEqual([document.querySelector('label[for="title"]')]);
  });
});

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#26843 — `layout: 'horizontal'` draws each label
 * BESIDE its control from `sm` up, and stacked below it.
 *
 * Before: the renderer read `layout` only to align the action row, so a form
 * view that saved and published `horizontal` drew exactly what `vertical` drew.
 *
 * What these pin:
 *  - a horizontal field item is a two-column grid at `sm`, the `<label>` its
 *    first child and every other child (control, description, message) placed
 *    in the second column;
 *  - every class horizontal adds is `sm:`-prefixed, so below `sm` the item is
 *    the vertical one — label above, control under it;
 *  - the label still names its control, and a group-labelled widget keeps its
 *    IDREF name: only the arrangement changes;
 *  - CONTROL: `vertical` and an absent `layout` draw byte-identical items.
 *
 * The geometry itself (label left of the input at 1024px, above it at 375px)
 * cannot be measured here — happy-dom applies no stylesheet; it was measured
 * once in Chromium for the pull request, against the built Tailwind CSS.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope (object-ui/no-dynamic-import-in-test-hook).
import '../../../renderers';

afterEach(cleanup);

const FIELDS = [
  { name: 'subject', label: 'Subject', type: 'input', description: 'One line' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
  { name: 'urgent', label: 'Urgent', type: 'checkbox' },
  { name: 'untitled', type: 'input' },
];

function renderForm(layout?: 'vertical' | 'horizontal') {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        showSubmit: false,
        fields: FIELDS,
        ...(layout ? { layout } : {}),
      }}
    />,
  );
}

const item = (name: string) => document.body.querySelector<HTMLElement>(`[data-field="${name}"]`)!;
const classesOf = (el: Element) => new Set(el.className.split(/\s+/).filter(Boolean));
/** The rendered form with React's generated ids normalised away. */
const normalisedHtml = () =>
  document.body.innerHTML
    .replace(/(id|for|aria-[a-z]+)="[^"]*"/g, '$1=""')
    .replace(/«[^»]*»|_r_[0-9a-z]+_|:r[0-9a-z]+:/g, '');

describe('layout: horizontal puts each label beside its control (objectstack#26843)', () => {
  it('each field item is a two-column grid at sm, the label in the first column', () => {
    renderForm('horizontal');
    for (const name of ['subject', 'notes', 'urgent']) {
      const el = item(name);
      const classes = classesOf(el);
      expect(classes.has('sm:grid'), name).toBe(true);
      expect(classes.has('sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]'), name).toBe(true);
      // Every child but the label is sent to the second column.
      expect(classes.has('sm:[&>:not(label)]:col-start-2'), name).toBe(true);
      expect(el.firstElementChild?.tagName, name).toBe('LABEL');
    }
    // The description stays a direct child, so it lands under the control in
    // the second column rather than under the label.
    expect(item('subject').querySelector(':scope > p')?.textContent).toBe('One line');
  });

  it('below sm the item is the vertical one: every class horizontal adds is sm:-prefixed', () => {
    renderForm('vertical');
    const vertical = Object.fromEntries(
      ['subject', 'notes', 'urgent', 'untitled'].map((n) => [n, classesOf(item(n))]),
    );
    cleanup();
    renderForm('horizontal');
    for (const name of ['subject', 'notes', 'urgent', 'untitled']) {
      const added = [...classesOf(item(name))].filter((c) => !vertical[name].has(c));
      // LIT CONTROL: horizontal does add classes.
      expect(added.length, name).toBeGreaterThan(0);
      expect(added.filter((c) => !c.startsWith('sm:')), name).toEqual([]);
      // ...and takes none away, so the stacked spacing below sm is vertical's.
      expect([...vertical[name]].filter((c) => !classesOf(item(name)).has(c)), name).toEqual([]);
    }
  });

  it('a field with no label keeps its control in the second column', () => {
    renderForm('horizontal');
    const el = item('untitled');
    expect(el.querySelector(':scope > label')).toBeNull();
    expect(classesOf(el).has('sm:[&>:not(label)]:col-start-2')).toBe(true);
    expect(el.querySelector('input')).not.toBeNull();
  });

  it('the labels still name their controls', () => {
    renderForm('horizontal');
    expect(screen.getByRole('textbox', { name: 'Subject' })).toBe(item('subject').querySelector('input'));
    expect(screen.getByRole('textbox', { name: 'Notes' })).toBe(item('notes').querySelector('textarea'));
    expect(screen.getByRole('checkbox', { name: 'Urgent' })).toBeTruthy();
  });

  it('CONTROL: an absent layout draws exactly what vertical draws, and neither is a grid', () => {
    renderForm('vertical');
    const vertical = normalisedHtml();
    expect(classesOf(item('subject')).has('sm:grid')).toBe(false);
    cleanup();
    renderForm();
    expect(normalisedHtml()).toBe(vertical);
    cleanup();
    // LIT CONTROL: the comparison tells the layouts apart.
    renderForm('horizontal');
    expect(normalisedHtml()).not.toBe(vertical);
  });
});

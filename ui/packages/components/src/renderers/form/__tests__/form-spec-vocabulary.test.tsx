/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Spec-vocabulary boundary in the standalone form renderer (#3090).
 *
 * `{ field: 'x' }` is the spec form-VIEW vocabulary — an object-field
 * reference the standalone renderer cannot resolve (no object schema). Writing
 * the first test here against the unfixed renderer proved the pre-#3090
 * behavior was even worse than the assumed silent drop: the entry slipped past
 * the `f?.name` guards into a react-hook-form Controller with
 * `name === undefined` and CRASHED the whole form on `name.split('.')`,
 * with nothing naming the culprit entry. The renderer now partitions such
 * entries out (the rest of the form renders) and surfaces them: an inline
 * alert naming the fields, and a console.error whose text doubles as the fix
 * instruction.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../../../renderers';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderForm(fields: any[]) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form schema={{ type: 'form', showSubmit: false, showCancel: false, fields }} />,
  );
}

describe('form renderer — spec-vocabulary entries surface loudly (#3090)', () => {
  it('renders an inline alert naming the unrenderable fields, and still renders the rest', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderForm([
      { name: 'subject', label: 'Subject', type: 'input' },
      { field: 'owner', required: true }, // spec form-view shape — unrenderable here
    ]);

    // The valid field still renders…
    expect(document.body.querySelector('[data-field="subject"]')).toBeTruthy();
    // …the spec-shaped one is called out instead of silently dropped.
    const alert = screen.getByTestId('form-spec-vocabulary-error');
    expect(alert.textContent).toContain('owner');
    expect(alert.textContent).toContain('{ name:');

    // The console message is the fix instruction an agent will follow.
    const said = error.mock.calls.map((c) => String(c[0])).join('\n');
    expect(said).toContain("{ field: 'owner' }");
    expect(said).toContain('Rename the key to `name`');
  });

  it('renders no alert and logs nothing for a well-formed standalone form', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    renderForm([{ name: 'subject', label: 'Subject', type: 'input' }]);

    expect(screen.queryByTestId('form-spec-vocabulary-error')).toBeNull();
    const noise = [...error.mock.calls, ...warn.mock.calls]
      .map((c) => String(c[0]))
      .filter((m) => m.includes('[object-ui]'));
    expect(noise).toEqual([]);
  });

  it('warns (but renders by `name`) when an entry mixes both vocabularies', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    renderForm([{ name: 'subject', field: 'subject_line', label: 'Subject', type: 'input' }]);

    // `name` wins — the field renders, no destructive alert…
    expect(document.body.querySelector('[data-field="subject"]')).toBeTruthy();
    expect(screen.queryByTestId('form-spec-vocabulary-error')).toBeNull();
    // …but the ignored spec key is called out.
    const said = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(said).toContain('mixes vocabularies');
    expect(said).toContain("{ field: 'subject_line' }");
  });

  it('does NOT flag the runtime metadata-object `field` slot (the #3090 pun)', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Object-bound paths stash the resolved field-metadata OBJECT under
    // `field` — same key, different layer. Only a STRING `field` marks the
    // spec authored shape; the object slot must pass without noise.
    renderForm([
      { name: 'amount', type: 'input', field: { type: 'currency', scale: 2 } },
    ]);

    expect(document.body.querySelector('[data-field="amount"]')).toBeTruthy();
    expect(screen.queryByTestId('form-spec-vocabulary-error')).toBeNull();
    const noise = [...error.mock.calls, ...warn.mock.calls]
      .map((c) => String(c[0]))
      .filter((m) => m.includes('[object-ui]'));
    expect(noise).toEqual([]);
  });
});

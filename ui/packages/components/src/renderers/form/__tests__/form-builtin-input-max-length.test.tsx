/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The built-in (unregistered) `input` branch honours a declared ceiling —
 * objectui#5201 — in the spec's spelling alone since objectui#11070.
 *
 * ## What was measured on `origin/main`
 *
 * The branch spread `stripRendererOnlyProps(fieldProps)` onto the element and
 * never read the declared ceiling, so one declaration split into two outcomes
 * depending on how it was spelled:
 *
 * | declaration | `maxlength` on the element | effect |
 * |---|---|---|
 * | `maxLength: 50` | `"50"` | capped — but by COINCIDENCE: `maxLength` happens to name a real DOM attribute |
 * | `max_length: 50` | `null`, plus a stray `max_length="50"` | NO cap at all, and invalid HTML |
 *
 * objectui#5201 fixed it by resolving `maxLength ?? max_length` here and
 * stripping the snake_case key off the element, because at the time
 * `max_length` was a live authoring spelling: the registered widgets
 * dual-read it and `packages/types` declared it on several field types.
 *
 * ## ⭐ objectui#11070 retired `max_length`
 *
 * `@objectstack/spec`'s `FieldSchema` and the strict authoring face refuse it
 * by name, no objectui type declares it any more, no in-repo producer writes
 * it, and every reader — this branch included — reads the spec's `maxLength`
 * alone, with no alias. So the snake_case spelling caps nothing here, and the
 * local strip went with the read. The retirement pin below is the reading of
 * that: a `max_length` authored on a hand-written form gets no `maxlength`.
 *
 * ## Scope
 *
 * The ceiling only. Whether a single-line input should also carry the visible
 * `{n}/{max}` counter and the announced limit that the built-in `textarea`
 * branch grew in objectui#3439 is an independent design trade-off that does
 * not follow from that card's conclusion; the #5201 triage ruling explicitly
 * left it undecided, so nothing here asserts a counter either way.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Module scope, not `beforeAll` — the cold transform must not be billed to
// `hookTimeout`. See object-ui/no-dynamic-import-in-test-hook (objectui#3010).
import '../../../renderers';

/** Render the built-in branch: no `registerAllFields()`, so nothing resolves from the registry. */
function renderForm(fields: any[]) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form schema={{ type: 'form', showSubmit: false, showCancel: false, fields }} />,
  );
}

const textField = (extra: Record<string, unknown> = {}) => ({
  name: 'title',
  label: 'Title',
  type: 'input',
  ...extra,
});

const input = () => document.querySelector('input') as HTMLInputElement;

afterEach(cleanup);

describe('built-in input — the declared ceiling (objectui#5201)', () => {
  it('applies a camelCase maxLength as the native attribute', () => {
    // This spelling worked before the fix, by the coincidence that it names a
    // real DOM attribute. Pinned so resolving the ceiling explicitly cannot
    // break the spelling that accidentally worked.
    renderForm([textField({ maxLength: 50 })]);
    expect(input().getAttribute('maxlength')).toBe('50');
  });

  it('the retired max_length caps nothing — the spec spelling is the only one read (objectui#11070)', () => {
    renderForm([textField({ max_length: 50 })]);
    expect(input().getAttribute('maxlength')).toBeNull();
  });

  it('leaves an uncapped field exactly as it was — no attribute either way', () => {
    renderForm([textField()]);
    expect(input().getAttributeNames()).not.toContain('maxlength');
  });
});

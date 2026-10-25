/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `FormSchema.previousValues` must not reach the `<form>` DOM node — objectui#6396.
 *
 * ## The leak, and why the existing `previousValues` tests never saw it
 *
 * `previousValues` is a DECLARED schema key with a real consumer: the form
 * renderer destructures it off `schema` and builds `previousRecord` from it,
 * which binds `previous` for field-rule CEL and is the INSERT/UPDATE signal the
 * read-only submit strip gates on (objectui#3484). That consumer reads
 * `schema.previousValues` and is untouched by this file.
 *
 * The leak is on the OTHER channel. `SchemaRenderer` spreads every non-metadata
 * top-level schema key as a React prop in addition to handing the node over as
 * `schema` — so an edit-mode host (`ObjectForm`, which is what the
 * `object-master-detail-form` header composes) puts `previousValues` into its
 * form node and the renderer receives a second, top-level copy in `...props`.
 * The renderer already consume-and-drops that family before its DOM spread
 * (`objectName`, `onDirtyChange`, `defaultValues`, …); `previousValues` was
 * simply missing from the list, so it rode `...formProps` onto `<form>` and
 * React declined it:
 *
 *     React does not recognize the `previousValues` prop on a DOM element. …
 *
 * Every existing `previousValues` test renders `<Form schema={…} />` directly
 * off the registry, which never populates `...props` — which is exactly why a
 * declared key could leak to the DOM on every edit-mode header render without a
 * single test noticing. This file therefore renders through `SchemaRenderer`,
 * the host path.
 *
 * ## The instrument
 *
 * ⭐ The symptom is a React `console.error`, not a thrown error and not a DOM
 * difference — a test that merely renders and passes would prove nothing. So
 * the assertion reads CAPTURED console output, and two controls keep that
 * capture honest:
 *
 *   - `catches a real unknown-prop warning` — the positive control. It proves
 *     the capture still sees React's unknown-prop notice at all. Without it the
 *     pin would keep passing if the capture broke, or if React stopped warning:
 *     a green vacuous assertion, which is the failure mode this card is about.
 *   - `tolerates unrelated console output` — the degenerate control. The pin
 *     matches the `previousValues` notice specifically, NOT "the render printed
 *     nothing", so the next unrelated warning cannot break it.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer } from '@object-ui/react';
// Module-scope import (not `beforeAll`) so the cold transform is billed to the
// import phase — objectui#3010 / object-ui/no-dynamic-import-in-test-hook.
import '../../../renderers';

/**
 * Run `fn` with `console.error` captured, and return one string per call.
 *
 * Each call's arguments are joined rather than read positionally on purpose:
 * React formats this notice as a `%s` template plus separate arguments, so the
 * prop name is NOT inside the format string. Matching over the joined call is
 * what makes the matcher below survive that (and survive React changing which
 * half carries the name).
 */
function captureConsoleError(fn: () => void): string[] {
  const calls: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    calls.push(args.map((a) => String(a)).join(' '));
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return calls;
}

/**
 * The captured unknown-prop notices naming `prop`.
 *
 * Deliberately two conditions ANDed, never "the capture is empty": this is the
 * degenerate-control guard in code form. An unrelated warning — or a second,
 * different unknown prop — must not make this fire.
 */
function unknownPropWarnings(calls: string[], prop: string): string[] {
  return calls.filter(
    (c) => /does not recognize/i.test(c) && new RegExp(`\\b${prop}\\b`).test(c),
  );
}

/** The header form node an edit-mode `ObjectForm` hands to `SchemaRenderer`. */
const HEADER_FORM_NODE = {
  type: 'form',
  objectName: 'po',
  fields: [
    { name: 'ref', label: 'Ref', type: 'input' },
    { name: 'status', label: 'Status', type: 'input' },
  ],
  defaultValues: { ref: 'PO-1', status: 'closed' },
  // Edit mode: the persisted record. Its PRESENCE is what makes this an update
  // rather than an insert (objectui#3484) — and what used to reach the DOM.
  previousValues: { ref: 'PO-1', status: 'closed' },
  showSubmit: false,
  showCancel: false,
};

describe('form renderer — `previousValues` must not reach the DOM (#6396)', () => {
  it('does not leak `previousValues` onto <form> on an edit-mode header render', () => {
    const calls = captureConsoleError(() => {
      render(<SchemaRenderer schema={HEADER_FORM_NODE as any} />);
    });

    expect(unknownPropWarnings(calls, 'previousValues')).toEqual([]);
  });

  it('still renders the header, and the DOM node carries no previousvalues attribute', () => {
    const { container } = render(<SchemaRenderer schema={HEADER_FORM_NODE as any} />);

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    // React lowercases an accepted custom attribute, so check that spelling too
    // — "no warning" and "no attribute" are two different facts and a future
    // `previousvalues` spelling would silence the warning without fixing this.
    expect(form!.getAttribute('previousvalues')).toBeNull();
    expect(form!.getAttribute('previousValues')).toBeNull();
  });

  it('POSITIVE CONTROL: the capture catches a real unknown-prop warning', () => {
    // A bare DOM element with an unknown prop — guaranteed to warn, and
    // independent of any renderer. If this goes red the pin above has become
    // vacuous (broken capture, or React no longer warning) and must not be read
    // as "the leak is fixed".
    const calls = captureConsoleError(() => {
      render(React.createElement('div', { madeUpProp: { a: 1 } }));
    });

    expect(unknownPropWarnings(calls, 'madeUpProp')).not.toEqual([]);
  });

  it('DEGENERATE CONTROL: tolerates unrelated console output on a clean render', () => {
    const calls = captureConsoleError(() => {
      const { previousValues: _dropped, ...insertNode } = HEADER_FORM_NODE;
      render(<SchemaRenderer schema={insertNode as any} />);
      // Something else entirely printed during this render. The pin must not
      // care — it pins one named prop, not silence.
      console.error('unrelated: some other component complained');
    });

    expect(calls.some((c) => c.includes('unrelated: some other component complained'))).toBe(true);
    expect(unknownPropWarnings(calls, 'previousValues')).toEqual([]);
  });
});

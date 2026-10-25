/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7246 — a `code` value whose TEXT is JSON rendered as the literal
 * `[Object]`. The showcase Field Zoo record's Code Editor field (`f_code`)
 * stores the STRING `{\n  "ok": true\n}` (confirmed against
 * `GET /api/v1/data/showcase_field_zoo/<id>`: a string, not an object), and the
 * detail page showed `[Object]` instead of the code.
 *
 * Mechanism: `coerceToSafeValue` classified strings BY SHAPE — anything
 * starting `{`/`[` and ending `}`/`]` was `JSON.parse`d, and the resulting
 * object fell through to the reference-label extraction
 * (`name || label || externalId || id || _id || '[Object]'`). `{"ok": true}`
 * carries none of those keys, so the cell rendered the placeholder. `code`,
 * `text`, `textarea`, `time`, `auto_number` and `qrcode` all register to
 * `TextCellRenderer`, so every one of them lost any JSON-shaped text.
 *
 * Shape is not a type. The reference unwrapping belongs to reference-typed
 * columns, and it already lives there: `LookupCellRenderer` carries its own
 * JSON-string branch (resolving through the referenced object's schema and
 * linking to the record, which the generic coercion never could). The control
 * case at the bottom pins that the #1426 scenario still works where it belongs
 * — this fix scopes the behaviour, it does not delete it.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { getCellRenderer, coerceToSafeValue, LookupCellRenderer } from '../index';

/** The exact string the reporting record stores in `f_code`. */
const F_CODE = '{\n  "ok": true\n}';

/**
 * Read the value the cell actually put in the DOM, byte-exact.
 * `TruncatedText` mirrors the full text into `title`, so RTL's whitespace
 * normalization can't hide a mangled multi-line value.
 */
function renderedText(ui: React.ReactElement): string {
  const { container } = render(ui);
  return container.textContent ?? '';
}

describe('text-like cells display JSON-shaped text verbatim (objectui#7246)', () => {
  it('code: the reporting value renders as its text, not "[Object]"', () => {
    const Cell = getCellRenderer('code');
    const text = renderedText(<Cell value={F_CODE} field={{ type: 'code' } as any} />);
    expect(text).toBe(F_CODE);
    expect(text).not.toContain('[Object]');
  });

  it.each(['text', 'textarea', 'code'] as const)(
    '%s: an object-literal string is not parsed away',
    (type) => {
      const Cell = getCellRenderer(type);
      const value = '{"ok": true}';
      expect(renderedText(<Cell value={value} field={{ type } as any} />)).toBe(value);
    },
  );

  it.each(['text', 'textarea', 'code'] as const)(
    '%s: an array-literal string is not joined away',
    (type) => {
      const Cell = getCellRenderer(type);
      // The array branch used to `.join(', ')` this into `1, 2, 3`.
      const value = '[1, 2, 3]';
      expect(renderedText(<Cell value={value} field={{ type } as any} />)).toBe(value);
    },
  );

  it('coerceToSafeValue returns every string verbatim, whatever its shape', () => {
    expect(coerceToSafeValue(F_CODE)).toBe(F_CODE);
    expect(coerceToSafeValue('{"ok": true}')).toBe('{"ok": true}');
    expect(coerceToSafeValue('[{"name":"A"}]')).toBe('[{"name":"A"}]');
    // The reference spelling itself: a *string* is text everywhere except a
    // reference-typed column, which resolves it in its own renderer below.
    expect(coerceToSafeValue('{"externalId":"Website Relaunch"}')).toBe(
      '{"externalId":"Website Relaunch"}',
    );
  });

  it('still coerces genuine OBJECT values — React error #310 stays fixed', () => {
    // Unchanged behaviour: an expanded reference arriving as an OBJECT (the
    // shape that actually reaches a cell) is still reduced to a label.
    expect(coerceToSafeValue({ name: 'Dev Admin', id: 'u1' })).toBe('Dev Admin');
    expect(coerceToSafeValue({ externalId: 'Website Relaunch' })).toBe('Website Relaunch');
    expect(coerceToSafeValue([{ name: 'A' }, { externalId: 'B' }])).toBe('A, B');
  });

  it('CONTROL: a reference COLUMN still unwraps a JSON-string reference', () => {
    // objectui#1426's scenario, on the column type it was written for. This is
    // the half that must not regress when the generic coercion stops guessing.
    const text = renderedText(
      <LookupCellRenderer
        value={'{"externalId":"Website Relaunch"}'}
        field={{ type: 'lookup', reference: 'project' } as any}
      />,
    );
    expect(text).toContain('Website Relaunch');
    expect(text).not.toContain('externalId');
  });
});

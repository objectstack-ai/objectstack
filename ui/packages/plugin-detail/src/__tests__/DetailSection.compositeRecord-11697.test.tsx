/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { DetailSection } from '../DetailSection';
import type { DetailViewSection } from '@object-ui/types';

/**
 * objectui#11697: on the record page the showcase Field Zoo's "Composite
 * (embedded object)" field read `{"width":10,"height":20}` and its "Record
 * (name-keyed map)" field read `{"primary":{"name":"A","score":…`, raw JSON in
 * a monospace face.
 *
 * End-of-path: these drive the real `DetailSection`, which reaches the value
 * through `getCellRenderer`, so they stay red if the table entry regresses even
 * when the renderer itself is fine. The renderer's own contract is pinned in
 * `@object-ui/fields`' `compositeRecordCell-11697`.
 */
describe('DetailSection — composite and record fields render labelled sub-values (objectui#11697)', () => {
  // The desktop row renders above the mobile breakpoint.
  beforeAll(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  });

  // The Field Zoo's two fields and its seed values.
  const objectSchema = {
    fields: {
      f_composite: { type: 'composite', label: 'Composite (embedded object)' },
      f_record: { type: 'record', label: 'Record (name-keyed map)' },
    },
  };
  const data = {
    f_composite: { width: 10, height: 20 },
    f_record: { primary: { name: 'A', score: 9 }, backup: { name: 'B', score: 7 } },
  };

  /** The value `<dl>` drawn in the row labelled `label`. */
  function valueListFor(container: HTMLElement, label: string): HTMLElement {
    const row = Array.from(container.querySelectorAll('div')).find(
      (div) => div.firstElementChild?.textContent === label,
    );
    expect(row, `a row labelled "${label}"`).toBeDefined();
    const list = row!.querySelector('dl');
    expect(list, `the "${label}" row draws a description list`).not.toBeNull();
    return list as HTMLElement;
  }

  /** The terms directly under one `<dl>`, minus the `aria-hidden` separators. */
  function termsOf(list: Element): string[] {
    return Array.from(list.querySelectorAll(':scope > div > dt')).map((term) => {
      const clone = term.cloneNode(true) as Element;
      clone.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
      return (clone.textContent ?? '').trim();
    });
  }

  it('a composite field renders labelled sub-values on the record page', () => {
    const { container } = render(
      <DetailSection
        section={{ fields: [{ name: 'f_composite', label: 'Composite (embedded object)' }] } as DetailViewSection}
        data={data}
        objectSchema={objectSchema}
      />,
    );
    const list = valueListFor(container, 'Composite (embedded object)');
    expect(termsOf(list)).toEqual(['Width', 'Height']);
    expect(list.textContent).toBe('Width 10 · Height 20');
    expect(container.textContent, 'no stored-JSON signature').not.toContain('{"width"');
  });

  it('a record field renders one labelled group per entry on the record page', () => {
    const { container } = render(
      <DetailSection
        section={{ fields: [{ name: 'f_record', label: 'Record (name-keyed map)' }] } as DetailViewSection}
        data={data}
        objectSchema={objectSchema}
      />,
    );
    const list = valueListFor(container, 'Record (name-keyed map)');
    expect(termsOf(list)).toEqual(['Primary', 'Backup']);
    expect(list.textContent).toBe('Primary (Name A · Score 9) · Backup (Name B · Score 7)');
    expect(container.textContent, 'no stored-JSON signature').not.toContain('{"primary"');
  });
});

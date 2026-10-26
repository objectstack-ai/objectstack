/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#5077 — a `record:highlights` chip must not offer inline edit for a
 * column the platform owns.
 *
 * Downstream (yinlianghui/hotcrm-heimao#61) a hook-maintained rollup was
 * overwritten by hand from the header strip and stayed corrupted until an
 * unrelated child-row touch re-fired the rollup. Such a column cannot be marked
 * `readonly` on the OBJECT — `stripReadonlyFields` would drop the hook's own
 * write-back too — so the declaration has to live on the highlight entry.
 *
 * `HeaderHighlight`'s gate always read `field.readonly`; the renderer's entry
 * normalization rebuilt each entry from `{name,label,icon,type}` and dropped
 * `readonly` one layer earlier, so the gate could never fire from authored
 * metadata. These tests pin the whole authored-metadata → chip path, not just
 * the gate in isolation.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { RecordContextProvider, InlineEditProvider } from '@object-ui/react';
import { RecordHighlightsRenderer } from '../renderers/record-highlights';

const objectSchema = {
  fields: {
    // Hook-maintained rollup. Declared a plain `number` on the object on
    // purpose: the object CANNOT carry `readonly: true` without killing the
    // cross-object hook that writes it.
    supply_share: { type: 'number' },
    owner: { type: 'text' },
  },
};

const data = { supply_share: 28.57, owner: 'Alice' };

const renderStrip = (fields: unknown[]) =>
  render(
    <InlineEditProvider canEdit>
      <RecordContextProvider
        objectName="crm_account"
        recordId="A1"
        data={data}
        objectSchema={objectSchema}
      >
        <RecordHighlightsRenderer schema={{ fields } as any} />
      </RecordContextProvider>
    </InlineEditProvider>,
  );

/**
 * The chip's inline-edit affordance: a hover pencil button plus the
 * `cursor-pointer` double-click target. Both are rendered iff
 * `canInlineEditField`, so either one answers "is this chip editable".
 */
const hasInlineEditAffordance = (container: HTMLElement) =>
  screen.queryAllByRole('button').length > 0 ||
  container.innerHTML.includes('cursor-pointer');

describe('record:highlights — authored `readonly` reaches the editability gate (#5077)', () => {
  it('renders a bare string entry as editable (control)', () => {
    const { container } = renderStrip(['owner']);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(hasInlineEditAffordance(container)).toBe(true);
  });

  it('renders an object entry WITHOUT `readonly` as editable (control)', () => {
    const { container } = renderStrip([{ name: 'supply_share', label: 'Supply Share' }]);
    expect(hasInlineEditAffordance(container)).toBe(true);
  });

  it('renders `{ name, readonly: true }` as NON-editable', () => {
    const { container } = renderStrip([{ name: 'supply_share', readonly: true }]);
    // Value still displayed — the point of a highlight is being seen; this is a
    // lock, not a redaction (`redactFields` is the remove-the-chip knob).
    expect(screen.getByText(/28\.57/)).toBeInTheDocument();
    expect(hasInlineEditAffordance(container)).toBe(false);
  });

  it('keeps `readonly` per-entry — one locked chip does not lock its siblings', () => {
    const { container } = renderStrip([
      { name: 'supply_share', readonly: true },
      { name: 'owner' },
    ]);
    // The editable sibling still has exactly one pencil.
    expect(screen.queryAllByRole('button')).toHaveLength(1);
    expect(container.innerHTML).toContain('cursor-pointer');
  });

  it('treats only `readonly: true` as a lock — a falsy value stays editable', () => {
    const { container } = renderStrip([{ name: 'supply_share', readonly: false }]);
    expect(hasInlineEditAffordance(container)).toBe(true);
  });
});

/**
 * The second half of #5077: an authored computed `type` must reach the SAME
 * gate the display-renderer selection reads. `TEXTUAL_REF_FALLBACK_TYPES`
 * (formula / summary / rollup / auto_number) is the computed-type set.
 *
 * This already held at HEAD — `resolvedType = field.type || objectDefField.type`
 * feeds both consumers — so these are pin tests: they fail loudly if the gate
 * and the renderer selection are ever given separate type resolutions again.
 */
describe('record:highlights — authored computed `type` disables inline edit (#5077)', () => {
  for (const type of ['formula', 'summary', 'rollup', 'auto_number']) {
    it(`renders an authored \`type: '${type}'\` entry as NON-editable`, () => {
      const { container } = renderStrip([{ name: 'supply_share', type }]);
      expect(hasInlineEditAffordance(container)).toBe(false);
    });
  }

  it('still honours a computed type declared only on the object', () => {
    const { container } = render(
      <InlineEditProvider canEdit>
        <RecordContextProvider
          objectName="crm_account"
          recordId="A1"
          data={data}
          objectSchema={{ fields: { supply_share: { type: 'rollup' } } }}
        >
          <RecordHighlightsRenderer schema={{ fields: ['supply_share'] } as any} />
        </RecordContextProvider>
      </InlineEditProvider>,
    );
    expect(hasInlineEditAffordance(container)).toBe(false);
  });
});

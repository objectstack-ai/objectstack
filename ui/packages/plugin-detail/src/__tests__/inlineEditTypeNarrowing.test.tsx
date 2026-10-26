/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3355 — an authored display `type` may NARROW inline-edit, never WIDEN it.
 *
 * Both editability gates used to resolve ONE effective type with display
 * precedence (`viewFieldType || objectFieldType`), so an authored non-computed
 * type erased the object's `formula` / `summary` / `rollup` / `auto_number`
 * declaration from the gate's view and handed the user an editor for a
 * machine-owned column.
 *
 * That is the shipped configuration of the app that reported
 * objectstack-ai/objectstack#5077: `{ name: 'supply_share', type: 'number' }`
 * — authored purely to fix formatting (objectstack#5066) — over a
 * hook-maintained ROLLUP. The rollup was overwritten by hand from the header
 * strip and stayed corrupted until an unrelated child-row touch re-fired it
 * (downstream yinlianghui/hotcrm-heimao#61).
 *
 * The gate is now the UNION of the two types (`isComputedFieldType`), shared by
 * the highlights strip and the details body so they cannot drift. Renderer
 * selection keeps the old precedence — nothing about the display changes.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { RecordContextProvider, InlineEditProvider } from '@object-ui/react';
import type { DetailViewSection } from '@object-ui/types';
import { RecordHighlightsRenderer } from '../renderers/record-highlights';
import { DetailSection } from '../DetailSection';
import { isComputedFieldType } from '../fieldEnrichment';

const COMPUTED_TYPES = ['formula', 'summary', 'rollup', 'auto_number'] as const;

const data = { supply_share: 28.57, owner: 'Alice' };

beforeAll(() => {
  // Desktop layout — the mobile branch renders its own read-only row shape.
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

// ---------------------------------------------------------------------------
// `record:highlights` — the header strip
// ---------------------------------------------------------------------------

const renderStrip = (fields: unknown[], objectSchema: Record<string, any>) =>
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
 * The chip's inline-edit affordance: the hover pencil button plus the
 * `cursor-pointer` double-click target — both rendered iff the chip is
 * editable, so either one answers the question.
 */
const hasInlineEditAffordance = (container: HTMLElement) =>
  screen.queryAllByRole('button').length > 0 ||
  container.innerHTML.includes('cursor-pointer');

describe('record:highlights — an authored `type` cannot widen editability (#3355)', () => {
  it("locks the reporter's exact config: `{ name: 'supply_share', type: 'number' }` over a rollup", () => {
    const { container } = renderStrip([{ name: 'supply_share', type: 'number' }], {
      fields: { supply_share: { type: 'rollup' } },
    });
    expect(hasInlineEditAffordance(container)).toBe(false);
  });

  it('still renders the value through the authored type — the lock is not a redaction', () => {
    renderStrip([{ name: 'supply_share', type: 'number' }], {
      fields: { supply_share: { type: 'rollup' } },
    });
    expect(screen.getByText(/28\.57/)).toBeInTheDocument();
  });

  for (const objectType of COMPUTED_TYPES) {
    it(`locks an authored \`type: 'number'\` over an object \`${objectType}\` field`, () => {
      const { container } = renderStrip([{ name: 'supply_share', type: 'number' }], {
        fields: { supply_share: { type: objectType } },
      });
      expect(hasInlineEditAffordance(container)).toBe(false);
    });
  }

  it("narrowing still works — authored `type: 'formula'` locks a plain object field", () => {
    const { container } = renderStrip([{ name: 'supply_share', type: 'formula' }], {
      fields: { supply_share: { type: 'number' } },
    });
    expect(hasInlineEditAffordance(container)).toBe(false);
  });

  it('leaves an authored non-computed type over a plain field editable (control)', () => {
    const { container } = renderStrip([{ name: 'supply_share', type: 'number' }], {
      fields: { supply_share: { type: 'number' } },
    });
    expect(hasInlineEditAffordance(container)).toBe(true);
  });

  it('leaves a bare entry over a plain field editable (control)', () => {
    const { container } = renderStrip(['owner'], { fields: { owner: { type: 'text' } } });
    expect(hasInlineEditAffordance(container)).toBe(true);
  });

  it('still honours an entry-level `readonly: true` (#3356 regression guard)', () => {
    const { container } = renderStrip(
      [{ name: 'supply_share', type: 'number', readonly: true }],
      { fields: { supply_share: { type: 'number' } } },
    );
    expect(hasInlineEditAffordance(container)).toBe(false);
  });

  it('locks only the offending chip — a sibling plain field stays editable', () => {
    renderStrip(
      [
        { name: 'supply_share', type: 'number' },
        { name: 'owner' },
      ],
      { fields: { supply_share: { type: 'rollup' }, owner: { type: 'text' } } },
    );
    expect(screen.queryAllByRole('button')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// `DetailSection` — the details body (same gate, second surface)
// ---------------------------------------------------------------------------

const renderSection = (
  field: Record<string, any>,
  objectSchema: Record<string, any>,
  { isEditing = false }: { isEditing?: boolean } = {},
) =>
  render(
    <DetailSection
      section={{ fields: [field] } as unknown as DetailViewSection}
      data={data}
      objectSchema={objectSchema}
      isEditing={isEditing}
      onEnterInlineEdit={vi.fn()}
    />,
  );

/** Read mode: the hover pencil is rendered iff the row is inline-editable. */
const hasPencil = () => screen.queryAllByLabelText('Double-click to edit').length > 0;

describe('DetailSection — an authored `type` cannot widen editability (#3355)', () => {
  it("locks the reporter's exact config: `{ name: 'supply_share', type: 'number' }` over a rollup", () => {
    renderSection({ name: 'supply_share', type: 'number' }, {
      fields: { supply_share: { type: 'rollup' } },
    });
    expect(hasPencil()).toBe(false);
  });

  it('renders no editor for that field even with the section in edit mode', () => {
    renderSection(
      { name: 'supply_share', type: 'number' },
      { fields: { supply_share: { type: 'rollup' } } },
      { isEditing: true },
    );
    expect(screen.queryByRole('spinbutton')).toBeNull();
    // The value is still shown, formatted by the authored `number` type.
    expect(screen.getByText(/28\.57/)).toBeInTheDocument();
  });

  for (const objectType of COMPUTED_TYPES) {
    it(`locks an authored \`type: 'number'\` over an object \`${objectType}\` field`, () => {
      renderSection(
        { name: 'supply_share', type: 'number' },
        { fields: { supply_share: { type: objectType } } },
        { isEditing: true },
      );
      expect(screen.queryByRole('spinbutton')).toBeNull();
    });
  }

  it("narrowing still works — authored `type: 'formula'` locks a plain object field", () => {
    renderSection(
      { name: 'owner', type: 'formula' },
      { fields: { owner: { type: 'text' } } },
      { isEditing: true },
    );
    expect(screen.queryByDisplayValue('Alice')).toBeNull();
    expect(hasPencil()).toBe(false);
  });

  it('leaves an authored non-computed type over a plain field editable (control)', () => {
    renderSection(
      { name: 'supply_share', type: 'number' },
      { fields: { supply_share: { type: 'number' } } },
      { isEditing: true },
    );
    expect(screen.getByRole('spinbutton')).toHaveValue(28.57);
  });

  it('leaves a plain field with no authored type editable (control)', () => {
    renderSection({ name: 'owner' }, { fields: { owner: { type: 'text' } } });
    expect(hasPencil()).toBe(true);
  });

  it('still honours `readonly` on the view field and on the object metadata', () => {
    renderSection({ name: 'owner', readonly: true }, { fields: { owner: { type: 'text' } } });
    expect(hasPencil()).toBe(false);

    renderSection({ name: 'owner' }, { fields: { owner: { type: 'text', readonly: true } } });
    expect(hasPencil()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The shared helper itself — one definition both gates call.
// ---------------------------------------------------------------------------

describe('isComputedFieldType — union, not precedence (#3355)', () => {
  it('is true when EITHER side is computed', () => {
    expect(isComputedFieldType('number', 'rollup')).toBe(true);
    expect(isComputedFieldType('formula', 'number')).toBe(true);
    expect(isComputedFieldType(undefined, 'auto_number')).toBe(true);
    expect(isComputedFieldType('summary', undefined)).toBe(true);
  });

  it('is false when neither side is computed', () => {
    expect(isComputedFieldType('number', 'number')).toBe(false);
    expect(isComputedFieldType(undefined, undefined)).toBe(false);
    expect(isComputedFieldType('text', null)).toBe(false);
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8279 — the designer's `element:definition-list` item controls write
 * the keys `DefinitionListRenderer` actually reads.
 *
 * ## What was broken
 *
 * `BLOCK_CONFIG['element:definition-list']` named its two item controls `label`
 * and `value`; `PageBlockInspector.renderField`'s array branch writes an item
 * key VERBATIM (`next[i] = { ...itemObj, [n]: v }`), so an author filled
 * `items[i].label` / `items[i].value`. The renderer reads `term` and
 * `description`, and its `toText` returns the em-dash `—` for null/undefined/
 * empty — so EVERY designer-built definition list rendered a blank term and a
 * literal `—` on every row, whatever the author typed.
 *
 * Nothing said so: both authored strings stayed in the document, and
 * `items.length` was non-zero so the renderer's own "No details" empty state
 * never fired. The author got a grid of blank labels and dashes and no
 * diagnostic anywhere.
 *
 * ## Why this file crosses the package boundary
 *
 * `element:definition-list` resolves to NO runtime-judgeable schema on either
 * face — it is not a spec `PageComponentType` (absent from `ComponentPropsMap`)
 * and no `@object-ui/types/zod` arm declares it, which is why objectui#8216's
 * parity gate carries it as an explicit exemption and why this defect had to be
 * found by reading. With no schema to judge either face against, the only
 * honest pin is the ROUND TRIP: author through the designer's own table, render
 * through the renderer's own registration, and read the DOM.
 *
 * So neither end is hard-coded here. The keys come from `BLOCK_CONFIG` and the
 * item is assembled the way `PageBlockInspector` assembles it; a future rename
 * on either face turns this red instead of silently re-opening the defect.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module scope, not a hook: the package's barrel registers the renderers as a
// side effect and the cost belongs to the import phase (AGENTS.md §测试纪律,
// object-ui/no-dynamic-import-in-test-hook).
import '@object-ui/components';
import { BLOCK_CONFIG, type BlockPropField } from '../block-config';

const BLOCK = 'element:definition-list';

/** The `items` array field, read out of the designer table itself. */
function itemsField(): Extract<BlockPropField, { kind: 'array' }> {
  const f = (BLOCK_CONFIG[BLOCK] ?? []).find((x) => x.name === 'items');
  if (!f || f.kind !== 'array') throw new Error(`${BLOCK} has no \`items\` array field`);
  return f;
}

/** The item-object keys a designer build writes — the producer's own answer. */
const DESIGNER_ITEM_KEYS = itemsField().itemFields.map((f) => f.name);

/**
 * Build one item exactly as `PageBlockInspector.renderField`'s array branch
 * does — `next[i] = { ...itemObj, [n]: v }`, one commit per control, in table
 * order. Assembling it rather than writing a literal is what makes the row
 * measure the PRODUCER instead of this file's opinion of it.
 */
function authorItem(values: readonly string[]): Record<string, unknown> {
  let item: Record<string, unknown> = {};
  DESIGNER_ITEM_KEYS.forEach((name, i) => {
    item = { ...item, [name]: values[i] };
  });
  return item;
}

function renderBlock(items: unknown[]) {
  const Component = ComponentRegistry.get(BLOCK);
  if (!Component) throw new Error(`Component "${BLOCK}" is not registered`);
  return render(<Component schema={{ type: BLOCK, properties: { items } }} />);
}

afterEach(cleanup);

describe('element:definition-list — designer item keys reach the renderer (objectui#8279)', () => {
  it('CONTROL — the harness CAN show authored text, so a red row below is the keys', () => {
    // Without this row every assertion below could fail for a broken harness
    // (renderer unregistered, DOM not mounted) and read as the key defect.
    // These are the renderer's own documented keys, taken from its registry
    // declaration: "Term/description pairs [{ term, description }]".
    const { getByTestId, queryByText } = renderBlock([{ term: 'Status', description: 'Active' }]);
    expect(getByTestId('definition-list')).toBeTruthy();
    expect(queryByText('Status')).toBeTruthy();
    expect(queryByText('Active')).toBeTruthy();
  });

  it('CONTROL — the em-dash IS what an unread description renders as', () => {
    // Pins the symptom's source, so the "no em-dash" row below cannot pass
    // merely because `toText` stopped producing one.
    const { queryByText } = renderBlock([{ term: 'Notes', description: '' }]);
    expect(queryByText('—')).toBeTruthy();
  });

  it('renders the text an author typed into the designer, on both faces', () => {
    const { queryByText } = renderBlock([authorItem(['Status', 'Active'])]);
    expect(queryByText('Status')).toBeTruthy();
    expect(queryByText('Active')).toBeTruthy();
  });

  it('does NOT render the em-dash for a description the author filled in', () => {
    // The defect's visible signature, and the half a "does the term render?"
    // check alone would miss: the description cell fell back to `—` rather
    // than staying blank, so the row looked populated and wrong.
    const { queryByText } = renderBlock([authorItem(['Status', 'Active'])]);
    expect(queryByText('—')).toBeNull();
  });

  it('the empty state is NOT the diagnostic — a populated item never reaches it', () => {
    // Why the defect was silent: `items.length` is non-zero, so "No details"
    // never fires no matter how unreadable the item's keys are.
    const { queryByText } = renderBlock([authorItem(['Status', 'Active'])]);
    expect(queryByText(/No details/i)).toBeNull();
  });
});

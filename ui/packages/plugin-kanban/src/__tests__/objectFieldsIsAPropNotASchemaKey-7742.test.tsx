/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `objectFields` is a PROP, no longer a key read off the `schema` bag
 * (objectui#7742, ADR-0049, maintainer decision batch #70, 2026-09-07).
 *
 * ## What moved, and why it was a defect
 *
 * `objectFields` carries the fetched object's field definitions so that a
 * conditional-formatting rule comparing a RELATION field sees the stored
 * foreign key rather than the record the board's `$expand` substituted for it
 * (objectui#3501). Only `ObjectKanban` can know the answer — it is the one
 * entry point that fetches an object definition.
 *
 * It used to travel INSIDE the `schema` bag. That made it reachable by an
 * AUTHOR: `BaseSchema` is `.passthrough()`, `SchemaRenderer` hands the node
 * down, and on the schema-only `kanban-ui` entry — which has no object schema
 * of its own to overwrite it with — an authored `objectFields` reached
 * `resolveConditionalFormatting` verbatim. No schema face declared the key, so
 * nothing judged it either: an author could hand the predicate layer a
 * fabricated field catalogue and change which cards a rule matched. Batch #70
 * ruled it an internal channel; it is now a React PROP, a sibling of `schema`.
 *
 * ## ⚠️ Scope — what the move closes, and what it does NOT
 *
 * It closes the SCHEMA READ PATH, which is exactly what the assertions below
 * pin: `KanbanRenderer` no longer reads `schema.objectFields`. On the `'kanban'`
 * arm that closes the key outright — `ObjectKanbanRenderer` serves that type key
 * and discards its rest-spread (`void _props;`), so an authored `objectFields`
 * on a `type: 'kanban'` node reaches nothing.
 *
 * ⛔ It does NOT make `objectFields` author-unreachable in general, and this
 * file must not be read as claiming that. `objectFields` is absent from
 * `SchemaRenderer`'s stripped-metadata list, so on the schema-only `'kanban-ui'`
 * entry an authored `objectFields` survives that renderer's generic prop spread
 * and arrives on the very prop asserted below. The tests here render
 * `KanbanRenderer` DIRECTLY and so never exercise `SchemaRenderer`: that entry
 * is measured but NOT pinned here, and closing it is a separate change.
 *
 * ## How this file discriminates, and why the fixture is shaped this way
 *
 * The two channels are told apart by an outcome that ONLY the field catalogue
 * can produce. The card's `owner` arrives EXPANDED (`{ _id: 'u1' }`), and the
 * rule compares `owner` against the bare id `'u1'`:
 *
 *   - with a catalogue naming `owner` a `lookup`, `toPredicateRecord` collapses
 *     the expanded value back to `'u1'`, the rule MATCHES, and the card is
 *     painted;
 *   - with no catalogue, `owner` stays an object, the rule does NOT match, and
 *     the card is unpainted.
 *
 * So "painted" is a positive reading of the channel and "unpainted" is a
 * negative one — and the positive case is asserted FIRST, as the firing control
 * for the negative. Without it, "the schema key did nothing" would also be
 * produced by a fixture that never worked on either channel, which is the
 * failure mode this pairing exists to rule out.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { KanbanRenderer } from '../index';

// Pay the board's lazy chunk at import time, not inside a `findBy` budget
// (AGENTS.md 测试纪律). The specifier stays byte-identical to the one in
// `../index` — ESM caches by resolved specifier, so this is what makes that
// module's own `React.lazy` factory resolve immediately.
import '../KanbanImpl';

/** The paint the matching rule applies — a colour no other element uses. */
const PAINT = 'rgb(255, 0, 0)';

// `{ condition, style }`: RESPELLED (objectui#11522) from the retired native
// `{ field: 'owner', operator: 'equals', value: 'u1', backgroundColor }` — the
// same comparison on the same relation field, the same paint.
const RULE = [{ condition: "record.owner == 'u1'", style: { backgroundColor: PAINT } }];

/** `owner` arrives EXPANDED, the way the board's own `$expand` delivers it. */
const CARD = { id: 'c1', title: 'Painted card', owner: { _id: 'u1', name: 'Ann' } };

/** The catalogue that makes `owner` collapsible. `lookup` is an expandable type. */
const FIELD_CATALOGUE = { owner: { type: 'lookup' } };

  // ⚠️ `object-kanban`, not the bare `kanban`: that node type key RETIRED
  // (objectui#8802). The value is inert on this path — `KanbanRendererProps`
  // types `schema.type` as `string` and nothing reads it — but a fixture that
  // spells a retired key teaches it, and this file is read as an example.
const BOARD = {
  type: 'object-kanban',
  columns: [{ id: 'todo', title: 'To Do', cards: [CARD] }],
  conditionalFormatting: RULE,
} as const;

/** The rendered card's own background, read off the element the title sits in. */
async function paintOfTheCard(): Promise<string> {
  const title = await screen.findByText('Painted card');
  let el: HTMLElement | null = title;
  while (el) {
    const bg = el.style?.backgroundColor;
    if (bg) return bg;
    el = el.parentElement;
  }
  return '';
}

describe('`objectFields` reaches the predicate layer as a PROP (objectui#7742)', () => {
  it('THE CONTROL — passed as a prop, the relation rule matches and the card is painted', async () => {
    // ⭐ Asserted first and on purpose. It proves the fixture CAN produce a
    // paint, so the negative below is a reading about the channel and not about
    // a rule that never matched on any channel.
    render(<KanbanRenderer schema={BOARD as never} objectFields={FIELD_CATALOGUE} />);
    expect(await paintOfTheCard()).toBe(PAINT);
  });
});

describe('`objectFields` is no longer read off the schema bag (objectui#7742)', () => {
  it('an AUTHORED `objectFields` inside `schema` does not reach the predicate layer', async () => {
    // The same catalogue, the same rule, the same card — written where an
    // author can write it. It must now do nothing.
    render(
      <KanbanRenderer schema={{ ...BOARD, objectFields: FIELD_CATALOGUE } as never} />,
    );
    expect(await paintOfTheCard()).not.toBe(PAINT);
  });

  it('and with neither channel supplied the card is unpainted — the paint is not unconditional', async () => {
    // The third leg: without it, "unpainted" above could be the board's default
    // for every card and would say nothing about `objectFields` at all.
    render(<KanbanRenderer schema={BOARD as never} />);
    expect(await paintOfTheCard()).not.toBe(PAINT);
  });
});

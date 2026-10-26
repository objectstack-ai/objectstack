/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8400 — the kanban card's title-dedupe skip set has to be keyed off
 * the SAME name-field ladder the card title itself is resolved with.
 *
 * ## The defect these tests pin
 *
 * `ObjectKanban` resolves each card's title through `getRecordDisplayName`
 * (ADR-0079), and then builds `titleFieldsToSkip` so the title's raw value is
 * not printed a second time as a card-body field. That skip set read
 * `objectDef?.NAME_FIELD_KEY` — a key NOTHING produces:
 *
 *   - `@objectstack/spec@17`'s object schema declares `nameField` (canonical)
 *     and `displayNameField` (deprecated alias). `NAME_FIELD_KEY` appears
 *     nowhere in the framework tree or in the published package.
 *   - This repo's own `record-title.ts` already treats it as a legacy alias,
 *     read as the LAST rung of `declaredNameField`, never emitted.
 *
 * So the read was always `undefined`, the skip set collapsed to its five
 * hard-coded literals (`name` / `full_name` / `title` / `subject` /
 * `display_name`), and any object whose name field is spelled otherwise printed
 * its title twice — once as the card heading, once as the first body row.
 *
 * That spelling is the norm for AI-built apps, whose objects name their fields
 * `visit_title` / `owner_name` / `<entity>_name`, which is why the defect was
 * invisible on hand-built objects whose name field is literally `name`.
 *
 * ## Why the ASSERTIONS are counts, not `toContain`
 *
 * The bug is a DUPLICATE, so presence proves nothing and absence would be the
 * wrong fix. Each test counts occurrences in the card's rendered text: exactly
 * one for the title, and at least one for every other declared card field. The
 * second half is what stops the suite from being satisfied by a board that
 * dropped the body entirely.
 *
 * ## The third test is the over-skip guard — read it before widening the ladder
 *
 * `record-details.tsx` solves the same duplicate for the detail grid
 * (objectui#8175) and UNROLLS the ladder into two candidates,
 * `resolveNameField()` **and** `deriveTitleField()`, because its dedupe has to
 * follow a value-keyed header that falls through to the derivation when the
 * declared pointer is blank on a record.
 *
 * That second rung is deliberately NOT copied here, and the third test is what
 * says so: it uses an object whose declared pointer (`code`) and derived
 * pointer (`owner_name`) DISAGREE, and asserts `owner_name` still renders. The
 * two surfaces differ in what the skip set is allowed to hide — the detail
 * grid walks a synthesized field list, whereas this set filters an
 * AUTHOR-DECLARED `cardFields`. On a four-field card, silently dropping a field
 * the author explicitly asked for is a worse failure than repeating a title, so
 * the ladder here stops at the one rung that answers "which field titles this
 * object".
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-kanban`.
import '../index';
// Cards render inside `KanbanRenderer`'s `React.lazy` boundary. Importing the
// chunk at module scope bills the cold transform to the import phase instead of
// racing a `waitFor` budget under full parallelism (the objectui#3010 rule) —
// same specifier as `index.tsx`'s factory, so ESM's module cache makes that
// factory resolve immediately.
import '../KanbanImpl';

/** Occurrences of `needle` in `haystack`. Plain scan — no regex escaping. */
function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return n;
    n += 1;
    from = at + needle.length;
  }
}

function makeAdapter(objectDef: Record<string, unknown>, record: Record<string, unknown>) {
  return {
    find: vi.fn().mockResolvedValue({ data: [record] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(objectDef),
  };
}

async function renderBoard(
  objectDef: Record<string, unknown>,
  record: Record<string, unknown>,
  cardFields: string[],
  awaitText: string,
) {
  const { container } = render(
    <SchemaRendererProvider dataSource={makeAdapter(objectDef, record) as never}>
      <SchemaRenderer
        schema={
          {
            type: 'object-kanban',
            objectName: objectDef.name,
            groupBy: 'status',
            columns: [{ id: 'scheduled', title: 'Scheduled' }],
            cardFields,
          } as never
        }
      />
    </SchemaRendererProvider>,
  );
  // Waiting on text that is on the card is what makes the counts below mean
  // "the card rendered and this is how often the value appears" rather than
  // "nothing has rendered yet" — the failure mode that makes a count vacuous.
  await waitFor(() => expect(container.textContent).toContain(awaitText));
  return container;
}

/** The AI-built shape from the report: an `<entity>_title` name field. */
const VISIT_DEF = {
  name: 'visit',
  nameField: 'visit_title',
  fields: {
    visit_title: { type: 'text', label: 'Visit' },
    pet_name: { type: 'text', label: 'Pet' },
    visit_at: { type: 'text', label: 'When' },
    status: { type: 'text', label: 'Status' },
  },
};

const VISIT_ROW = {
  id: 'v1',
  visit_title: 'Dental cleaning assessment',
  pet_name: 'Cola',
  visit_at: '2026-09-07 09:30',
  status: 'scheduled',
};

const TITLE = VISIT_ROW.visit_title;

describe('kanban cards do not print the record title twice (objectui#8400)', () => {
  it('a DECLARED `nameField` listed in `cardFields` renders once, as the heading only', async () => {
    // THE repro. `visit_title` is the object's declared name field AND an
    // author-listed card field. Before the fix the skip set was keyed off
    // `objectDef.NAME_FIELD_KEY` (always undefined), so `visit_title` was not
    // skipped and its value rendered as both heading and first body row.
    const container = await renderBoard(
      VISIT_DEF,
      VISIT_ROW,
      ['visit_title', 'pet_name', 'visit_at'],
      TITLE,
    );
    expect(countOccurrences(container.textContent ?? '', TITLE)).toBe(1);
  });

  it('the other declared card fields still render (positive control)', async () => {
    // Without this, the assertion above is satisfied by a board that skipped
    // every card field, or rendered no body at all.
    const container = await renderBoard(
      VISIT_DEF,
      VISIT_ROW,
      ['visit_title', 'pet_name', 'visit_at'],
      TITLE,
    );
    const text = container.textContent ?? '';
    expect(text).toContain(VISIT_ROW.pet_name);
    expect(text).toContain(VISIT_ROW.visit_at);
  });

  it('a DERIVED name field (no `nameField` declared) is deduped too, and does not get worse', async () => {
    // No declared pointer at all, so `getRecordDisplayName` reaches its
    // type-aware derivation (step 4) and titles the card with `visit_title`
    // because of the `_title` affix. `resolveNameField` falls through to the
    // SAME derivation, so the skip set follows the heading here as well.
    const { name, fields } = VISIT_DEF;
    const derivedDef = { name, fields };
    const container = await renderBoard(
      derivedDef,
      VISIT_ROW,
      ['visit_title', 'pet_name'],
      TITLE,
    );
    const text = container.textContent ?? '';
    expect(countOccurrences(text, TITLE)).toBe(1);
    // Same positive control: the derivation must dedupe the title, not the card.
    expect(text).toContain(VISIT_ROW.pet_name);
  });

  it('does NOT hide a card field that merely LOOKS name-ish while another field is declared', async () => {
    // Over-skip guard (see the file docblock). Declared pointer and derived
    // pointer disagree: `nameField: 'code'` titles the card, while
    // `deriveTitleField` would answer `owner_name` on the `_name` affix. The
    // author listed `owner_name`, the heading never showed it, so it must
    // render. This goes RED if the skip set is ever widened to also carry the
    // derivation alongside a declared pointer.
    const def = {
      name: 'contract',
      nameField: 'code',
      fields: {
        code: { type: 'text', label: 'Code' },
        owner_name: { type: 'text', label: 'Owner' },
        status: { type: 'text', label: 'Status' },
      },
    };
    const row = {
      id: 'c1',
      code: 'CT-4471-KLM',
      owner_name: 'Zhou Mingxuan',
      status: 'scheduled',
    };
    const container = await renderBoard(def, row, ['code', 'owner_name'], row.code);
    const text = container.textContent ?? '';
    expect(countOccurrences(text, row.code)).toBe(1);
    expect(text).toContain(row.owner_name);
  });
});

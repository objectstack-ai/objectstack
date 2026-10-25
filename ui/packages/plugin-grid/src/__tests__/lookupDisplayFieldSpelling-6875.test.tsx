/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6875 — a lookup cell in `ObjectGrid` must honour the author's
 * `displayField`, the SPEC-DECLARED spelling.
 *
 * ⭐ objectui#7155 INVERTED the second half of this pin. It used to assert
 * PARITY: both spellings resolve to the same value. That parity was the visible
 * face of a two-dialect seam — `@objectstack/spec` declared camelCase and
 * refused snake_case, while `@object-ui/types`' widget metadata declared
 * snake_case and refused camelCase, and the read chains served both with the
 * snake leg FIRST. The maintainer ruled to converge the contracts on the spec's
 * spelling in one payment, so the snake leg is gone from the chains, the
 * published type, the docs and all seven in-repo producers.
 *
 * ⇒ This file now pins the REFUSAL: a def carrying `display_field` resolves to
 * the generic name heuristic (the key is unread), and a def carrying
 * `displayField` resolves to the author's pointer. ⛔ Do not "fix" the snake
 * column back to green — that would restore the seam and make an undeclared
 * key outrank a declared one.
 *
 * ## Why this file renders a cell instead of asserting a key list
 *
 * The sibling pins in this directory (`relationalMetaCopySet-6711` /
 * `-6874`) assert what does and does not land on the `fieldMeta` bag. That is
 * the right instrument for a retirement, where nothing renders differently.
 * Here something DOES render differently, and the card was filed as a static
 * producer-vs-consumer measurement with no user report attached — so the thing
 * worth pinning is the user-visible outcome, not the copy set that causes it.
 *
 * ## The measurement this file encodes
 *
 * `@objectstack/spec` 17.2.0's `FieldSchema` is a strict object with 71 props.
 * It declares `displayField`, `descriptionField`, `lookupColumns`,
 * `lookupFilters` and `reference`. It declares NONE of `display_field`,
 * `description_field`, `lookup_columns`, `reference_to`, `reference_field` —
 * those parse to `unrecognized_keys`, the same code a nonsense key gets, so no
 * spec-compliant producer can ship one. Measured on the installed package, with
 * `name`/`type`/`label` as the positive control.
 *
 * Nothing renames them on the way in either: `ObjectStackAdapter.getObjectSchema`
 * (`@object-ui/data-objectstack`) is the choke point every schema read goes
 * through, and its only key rewrite is `normalizeSchemaReferenceKeys` — a
 * legacy `reference_to` folded onto `reference`, nothing else (it stamped the
 * pair both ways until objectui#11070 round 4).
 *
 * ⇒ On a live path the ONLY display-field spelling that can reach this grid is
 * `displayField`, and it was the one spelling `RELATIONAL_META_KEYS` did not
 * copy. The consumer — `LookupCellRenderer` in `@object-ui/fields` — reads
 * `display_field || displayField || reference_field`, so it was ready for the
 * key the whole time; the value simply never arrived.
 *
 * ## The control that makes the refusal a reading
 *
 * Two columns render from ONE data source, ONE referenced record and ONE cell
 * renderer, differing only in the spelling on the field def:
 *
 *   `code_camel` → `{ displayField: 'project_code' }`   (spec-declared, READ)
 *   `code_snake` → `{ display_field: 'project_code' }`  (retired, UNREAD)
 *
 * ⚠️ The roles have swapped. The CAMEL column is now the positive control: it
 * must resolve `ACME-42`, which proves the lookup path is reached and the
 * resolver is returning a value at all. Without it, "the snake column does not
 * show `ACME-42`" would be satisfied by a fixture that never rendered a lookup
 * — the exact failure this file's original control existed to rule out.
 *
 * And the snake column's refusal is asserted POSITIVELY, by what it resolves TO
 * (`Wrong Name`, the referenced record's `name` via the generic heuristic), not
 * merely by the absence of `ACME-42`. A cell that rendered nothing at all would
 * pass an absence-only assertion; it fails this one.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();

const OBJECT = 'os_6875_task';
const REFERENCED = 'os_6875_project';

/** The referenced record. `name` is deliberately WRONG so the fallback is visible. */
const PROJECT = { id: 'p1', name: 'Wrong Name', project_code: 'ACME-42' };

const ROWS = [{ id: 't1', title: 'Task one', code_camel: 'p1', code_snake: 'p1' }];

function makeDataSource() {
  return {
    find: vi.fn(async (objectName: string) => {
      if (objectName === REFERENCED) {
        return { data: [PROJECT], total: 1, hasMore: false, pageSize: 50 };
      }
      return { data: ROWS, total: ROWS.length, hasMore: false, pageSize: 50 };
    }),
    findOne: vi.fn(async (objectName: string, id: string) =>
      objectName === REFERENCED && id === 'p1' ? PROJECT : null,
    ),
    getObjectSchema: async (name: string) => {
      if (name === REFERENCED) {
        // No `nameField`, no `titleFormat` — so nothing but the field def's
        // display pointer can produce `ACME-42`.
        return { name, fields: { id: { type: 'text' }, name: { type: 'text' }, project_code: { type: 'text' } } };
      }
      return {
        name,
        fields: {
          id: { type: 'text' },
          title: { type: 'text', label: 'Title' },
          // Spec-declared spelling — the only one read since objectui#7155.
          code_camel: { type: 'lookup', label: 'Project (spec spelling)', reference: REFERENCED, displayField: 'project_code' },
          // Retired snake_case spelling. Authored here on purpose: this column
          // must DEGRADE to the generic heuristic, proving the leg is gone.
          code_snake: { type: 'lookup', label: 'Project (runtime spelling)', reference: REFERENCED, display_field: 'project_code' },
        },
      };
    },
  } as any;
}

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

async function renderGrid() {
  const ds = makeDataSource();
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    data: ROWS,
    pagination: { pageSize: 50 },
    columns: [
      { field: 'code_camel', label: 'Project (spec spelling)', type: 'lookup' },
      { field: 'code_snake', label: 'Project (runtime spelling)', type: 'lookup' },
    ],
  };
  render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={ds}>
        <ObjectGrid schema={schema} dataSource={ds} />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
  // The control column proves the lookup path itself is reached and resolving.
  await waitFor(() => {
    expect(screen.getByText('Project (runtime spelling)')).toBeInTheDocument();
  });
}

describe('objectui#6875 — ObjectGrid lookup cells honour the spec-declared `displayField`', () => {
  it('the spec spelling `displayField` resolves the declared display value (CONTROL)', async () => {
    await renderGrid();
    await waitFor(() => {
      expect(screen.getAllByText('ACME-42').length).toBeGreaterThan(0);
    }, { timeout: 4000 });
  });

  it('⛔ objectui#7155 — the retired `display_field` is UNREAD: exactly one column resolves, and the snake column falls back to the generic name heuristic', async () => {
    await renderGrid();
    // CONTROL first: the camel column resolves, so the lookup path is reached
    // and the resolver is returning values. Only then is the snake column's
    // behaviour a measurement rather than an empty render.
    await waitFor(() => {
      expect(screen.getAllByText('ACME-42').length).toBeGreaterThan(0);
    }, { timeout: 4000 });

    // ⭐ The refusal, asserted by what the snake column resolves TO. Before
    // objectui#7155 this was 2 (both spellings read); now the retired spelling
    // reaches nothing and its cell degrades to the referenced record's `name`.
    await waitFor(() => {
      expect(screen.getByText('Wrong Name')).toBeInTheDocument();
    }, { timeout: 4000 });
    expect(screen.getAllByText('ACME-42').length).toBe(1);
  });
});

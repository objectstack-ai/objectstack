/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The RENDERER half of the `TableColumn.type` value-level parity pin
 * (objectui#5853, maintainer ruling 2026-08-25, Option B).
 *
 * The declaration half — interface tuple ↔ zod mirror ↔ the producer-seam fold
 * — lives in `packages/types/src/__tests__/table-column-type-canonical.test.ts`.
 * This file pins the third end, the one neither of those can see: the set of
 * `type` values `data-table` actually BRANCHES ON. That end is the reason the
 * card existed. The renderer read a vocabulary matching neither of the other
 * two (`int` / `integer` / `float` / `double` in `NUMERIC_EDIT_TYPES`, plus a
 * `datetime-local` editor branch), and it could only do so through an
 * `as any` cast, which is the shape "declared ≠ enforced" takes in TypeScript.
 *
 * ## ⭐ A new branch on an undeclared spelling turning this red is BY DESIGN
 *
 * ⛔ Do not repair it by re-adding the cast. Either publish the value (add it
 * to `TABLE_COLUMN_TYPES`, all three ends together, `minor` + changeset), or
 * fold it at the producer's emit seam so it never reaches the slot.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, fireEvent } from '@testing-library/react';
import { TABLE_COLUMN_TYPES } from '@object-ui/types';
import { renderComponent } from '../../../__tests__/test-utils';
// Module-scope side-effect import, not a `beforeAll` — see
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../../../renderers';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

/* ── the renderer source, comments stripped ──────────────────────────────── */

// `__dirname`-relative, the repo's idiom for source-reading tests: in the dom
// project `import.meta.url` is not a `file:` URL, so `new URL(…)` cannot
// resolve it.
const RAW = readFileSync(resolve(__dirname, '../data-table.tsx'), 'utf8');
/** Code only: a spelling named in a comment must not count as a branch. */
const CODE = mask(RAW);

const DECLARED = new Set<string>(TABLE_COLUMN_TYPES);

/** Every literal the renderer compares `editType` against. */
function comparisonLiterals(): string[] {
  return [...CODE.matchAll(/editType\s*===\s*'([^']*)'/g)].map((m) => m[1]!);
}

/** Every member of the `NUMERIC_EDIT_TYPES` set literal. */
function numericSetMembers(): string[] {
  const decl = CODE.match(/NUMERIC_EDIT_TYPES\s*=\s*new Set(?:<[^>]*>)?\(\[([^\]]*)\]\)/);
  expect(decl).not.toBeNull();
  return [...decl![1]!.matchAll(/'([^']*)'/g)].map((m) => m[1]!);
}

describe('the derivation instrument sees every branch the renderer takes', () => {
  it('reads the column type exactly once, and not through a cast', () => {
    // The cast (`(col as any).type as string | undefined`) is what let the
    // undeclared vocabulary in. One typed read means one place to pin.
    expect(CODE).toMatch(/const editType:\s*TableColumnType\s*\|\s*undefined\s*=\s*col\.type;/);
    expect(CODE).not.toMatch(/\(col as any\)\.type/);
    expect([...CODE.matchAll(/\bconst editType\b/g)]).toHaveLength(1);
  });

  it('does not branch on the column type in a form this file cannot see', () => {
    // A `switch (editType)`, an `includes(editType)` against some other set, or
    // a second Set of type spellings would each hide a branch from the pin.
    // Whoever introduces one must upgrade the derivation with it.
    expect(CODE).not.toMatch(/switch\s*\(\s*editType\s*\)/);
    expect(CODE).not.toMatch(/\.includes\(\s*editType\s*\)/);
    expect([...CODE.matchAll(/\.has\(\s*editType\s*\)/g)]).toHaveLength(1);
  });
});

describe('the renderer branches ONLY on spellings the interface publishes', () => {
  it('every `editType === ...` literal is a declared column type', () => {
    const undeclared = comparisonLiterals().filter((t) => !DECLARED.has(t));
    expect(undeclared).toEqual([]);
  });

  it('every NUMERIC_EDIT_TYPES member is a declared column type', () => {
    const members = numericSetMembers();
    expect(members.length).toBeGreaterThan(0);
    expect(members.filter((t) => !DECLARED.has(t))).toEqual([]);
  });

  it('the four numeric aliases are gone from the renderer entirely', () => {
    // They were never declared; they arrived because producers forwarded an
    // object schema's field type verbatim. The fold at the emit seam is what
    // replaced them — see `normalizeTableColumnType`.
    expect(numericSetMembers()).toEqual(['number', 'currency', 'percent']);
    expect(comparisonLiterals()).not.toContain('datetime-local');
  });
});

/* ── T1: what happens to a column whose type is out of union ─────────────── */

const OUT_OF_UNION = 'select';

function schemaWithColumnType(type?: string) {
  return {
    type: 'data-table' as const,
    editable: true,
    singleClickEdit: true,
    columns: [
      { header: 'Name', accessorKey: 'name' },
      { header: 'Stage', accessorKey: 'stage', ...(type ? { type } : {}) },
    ],
    data: [{ id: '1', name: 'Acme', stage: 'won' }],
  } as any;
}

describe('an out-of-union type degrades to the no-type path — the column survives', () => {
  it('renders the column and its cell even when handed an undeclared type', () => {
    // ⛔ The rule the fold must never break: an undeclared type drops the
    // ANNOTATION, never the column. A producer that fails to fold still hands
    // this renderer a raw spec field type, and the column must still draw.
    const { container } = renderComponent(schemaWithColumnType(OUT_OF_UNION));
    expect(screen.getByText('Stage')).toBeTruthy();
    expect(container.textContent).toContain('won');
  });

  it('opens the SAME editor as a column carrying no type at all', () => {
    // This is why dropping the annotation is behaviour-preserving: the
    // renderer's non-date / non-numeric path IS the `undefined` path. Both
    // land on the built-in text input.
    const editorFor = (type?: string): string | null => {
      const { container, unmount } = renderComponent(schemaWithColumnType(type));
      const cells = container.querySelectorAll('tbody td');
      fireEvent.click(cells[1] as HTMLElement);
      const input = container.querySelector('tbody input');
      const result = input ? (input.getAttribute('type') ?? '(none)') : null;
      unmount();
      return result;
    };

    const withUndeclared = editorFor(OUT_OF_UNION);
    const withNoType = editorFor(undefined);
    expect(withUndeclared).not.toBeNull();
    expect(withUndeclared).toBe(withNoType);
  });
});

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * declared = enforced for the static `table` renderer (objectui#5474,
 * maintainer ruling 2026-08-22: Option C — split the types).
 *
 * This file is the acceptance property of the split, spelled as an
 * INSTRUMENT rather than as per-key assertions: it derives the renderer's
 * actual read set from `../table.tsx`'s source and compares it, both ways,
 * against the live (non-tombstoned) keys the narrow zod surface declares.
 * A key declared live but never read goes red here; so does a key the
 * renderer starts reading without declaring. Eleven keys sat in the first
 * state for as long as the static table shared `data-table`'s rich
 * `TableColumn` — that is the defect class this file exists to make
 * unrepresentable, in either direction.
 *
 * ## The instrument's own blind spots are guarded, not assumed away
 *
 * objectui#5474's census was derived with `grep -oE '(schema|col)\.[a-zA-Z]+'`,
 * which cannot see a destructured read, a computed access, or a key consumed
 * through a helper that receives the whole object. The same limitation applies
 * to the regex here, so the suite FAILS if any of those patterns appears in
 * the renderer source — whoever introduces one must upgrade this derivation
 * along with it, instead of the instrument silently under-counting.
 * (Re-derived for #5474 by full-file read plus the SchemaRenderer prop-flow:
 * the census's 9-read / 11-inert numbers were confirmed exact.)
 *
 * The refusal half — the retired keys failing parse loudly — is pinned in
 * `packages/types/src/__tests__/static-table-narrow-surface.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import {
  BaseSchema as BaseZod,
  StaticTableColumnSchema,
  TableSchema as TableZod,
} from '@object-ui/types/zod';
// Module-scope side-effect import, not a `beforeAll` — see
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../table';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

/* ── the renderer source, comments stripped ──────────────────────────────── */

// `__dirname`-relative, the repo's idiom for source-reading tests
// (`readme-shadcn-sync-categories.test.ts`): in the dom project
// `import.meta.url` is not a `file:` URL, so `new URL(…)` cannot resolve it.
const SOURCE_PATH = resolve(__dirname, '../table.tsx');
const RAW = readFileSync(SOURCE_PATH, 'utf8');
/** Code only: a `col.header` in a comment must not count as a read. */
const CODE = mask(RAW);

/* ── zod shape introspection (zod 4; one-hop unwrap, tombstone-aware) ────── */

function shapeOf(schema: unknown): Record<string, unknown> {
  const carrier = schema as { shape?: unknown; _def?: { shape?: unknown } };
  const shape = carrier?.shape ?? carrier?._def?.shape;
  const resolved = typeof shape === 'function' ? (shape as () => object)() : shape;
  return (resolved ?? {}) as Record<string, unknown>;
}

function isTombstoned(schema: unknown, key: string): boolean {
  const member = shapeOf(schema)[key] as { unwrap?: () => unknown } | undefined;
  const inner = typeof member?.unwrap === 'function' ? member.unwrap() : member;
  const def = inner as { _def?: { type?: string }; def?: { type?: string } } | undefined;
  return (def?._def?.type ?? def?.def?.type) === 'never';
}

const liveKeys = (schema: unknown) =>
  Object.keys(shapeOf(schema)).filter((k) => !isTombstoned(schema, k));

/* ── the derived read sets ───────────────────────────────────────────────── */

const readsOf = (receiver: 'col' | 'schema') => {
  const reads = new Set<string>();
  for (const match of CODE.matchAll(new RegExp(`\\b${receiver}\\.([A-Za-z_$][\\w$]*)`, 'g'))) {
    reads.add(match[1]);
  }
  return reads;
};

describe('the derivation instrument sees every read the renderer performs', () => {
  it('the renderer does not destructure `col` or `schema`', () => {
    // `const { header } = col` is a read this file's regex cannot see.
    expect(CODE).not.toMatch(/\}\s*=\s*col\b/);
    expect(CODE).not.toMatch(/\}\s*=\s*schema\b/);
  });

  it('the renderer does not use computed access on `col` or `schema`', () => {
    // `col[someKey]` is a read this file's regex cannot see. (`row[...]` is
    // fine — that reads DATA, keyed by an accessor the col reads supply.)
    expect(CODE).not.toMatch(/\bcol\s*\[/);
    expect(CODE).not.toMatch(/\bschema\s*\[/);
  });

  it('the renderer does not hand `col` or `schema` whole to a helper', () => {
    // `helper(col)` hides reads inside the helper. Member arguments
    // (`renderChildren(schema.footer)`) are counted by the regex already.
    expect(CODE).not.toMatch(/[(,]\s*col\s*[,)]/);
    expect(CODE).not.toMatch(/[(,]\s*schema\s*[,)]/);
  });

  it('columns are typed as the narrow StaticTableColumn at both read sites', () => {
    // The type link the split created: retyping the callbacks back to the
    // rich `TableColumn` would silently re-open the wide surface to tsc.
    expect(RAW.match(/col:\s*StaticTableColumn\b/g)).toHaveLength(2);
  });
});

describe('declared = enforced, both directions (objectui#5474)', () => {
  it('column keys: the renderer reads exactly the narrow live set', () => {
    const declared = new Set(liveKeys(StaticTableColumnSchema));
    const read = readsOf('col');
    // Two assertions, not a set-equality one-liner, so a failure names the
    // DIRECTION: declared-but-unread is the silent-knob defect, while
    // read-but-undeclared is enforcement outrunning the contract.
    expect([...declared].filter((k) => !read.has(k)), 'declared live but never read').toEqual([]);
    expect([...read].filter((k) => !declared.has(k)), 'read but not declared live').toEqual([]);
  });

  it('schema keys: the renderer reads exactly the table-specific live set', () => {
    // The table-specific surface = the live zod keys the table DECLARES
    // BEYOND BaseSchema, minus the `type` discriminant (consumed by the
    // registry, not the renderer). Inherited BaseSchema keys (`className`,
    // `visible`, …) are honoured by the SchemaRenderer HARNESS for every
    // component, so they are not this renderer's to read.
    //
    // "Beyond" is decided by shape-member IDENTITY, not key name: `.extend()`
    // keeps the base's member objects by reference for keys it does not
    // redefine, so a key the table REDEFINED (`data` — an array of rows here,
    // `z.any()` "custom data payload" on the base) counts as table-specific
    // while purely inherited keys do not. A name-based subtraction
    // misclassified exactly that key — caught by this suite's first run.
    const baseShape = shapeOf(BaseZod);
    const tableShape = shapeOf(TableZod);
    const declared = new Set(
      liveKeys(TableZod).filter(
        (k) => k !== 'type' && tableShape[k] !== baseShape[k],
      ),
    );
    const read = readsOf('schema');
    expect([...declared].filter((k) => !read.has(k)), 'declared live but never read').toEqual([]);
    expect([...read].filter((k) => !declared.has(k)), 'read but not declared live').toEqual([]);
  });
});

describe('the retired keys are runtime-inert on the renderer (the receipt)', () => {
  // The refusal lives at validation; the RENDERER stays byte-identical when a
  // retired key is smuggled past it. This is the measured premise the ruling
  // stood on — pinned so the split can never be mistaken for a behaviour
  // change, and so Option A (implementing the knobs) cannot land by accident.
  const renderStatic = (schema: object) => {
    const Table = ComponentRegistry.get('table') as React.ComponentType<{ schema: unknown }>;
    if (!Table) throw new Error('table not registered');
    return render(<Table schema={schema} />);
  };

  it('a column authoring `align`/`sortable` renders identically to a clean one', () => {
    const clean = renderStatic({
      type: 'table',
      columns: [{ header: 'Amount', accessorKey: 'amount' }],
      data: [{ amount: '$1,200' }],
    });
    const cleanHtml = clean.container.innerHTML;
    clean.unmount();

    const smuggled = renderStatic({
      type: 'table',
      columns: [{ header: 'Amount', accessorKey: 'amount', align: 'right', sortable: true }],
      data: [{ amount: '$1,200' }],
    });
    expect(smuggled.container.innerHTML).toBe(cleanHtml);
    expect(smuggled.container.innerHTML).not.toContain('text-right');
  });

  it('`hoverable`/`striped` change nothing the renderer emits', () => {
    const clean = renderStatic({
      type: 'table',
      columns: [{ header: 'A', accessorKey: 'a' }],
      data: [{ a: 1 }, { a: 2 }],
    });
    const cleanHtml = clean.container.innerHTML;
    clean.unmount();

    const smuggled = renderStatic({
      type: 'table',
      columns: [{ header: 'A', accessorKey: 'a' }],
      data: [{ a: 1 }, { a: 2 }],
      hoverable: true,
      striped: true,
    });
    expect(smuggled.container.innerHTML).toBe(cleanHtml);
  });
});

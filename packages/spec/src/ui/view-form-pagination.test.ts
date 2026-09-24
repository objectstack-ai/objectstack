// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Studio view form offers `pagination` to EVERY view type, and keeps the
 * grid-only display options grid-only.
 *
 * ## What is being pinned
 *
 * `pagination.pageSize` is the row bound every view type carries; maintainer
 * ruling D on #19228 makes it the direction for a view's row bound. The form
 * used to offer `pagination` only inside `table_options`
 * (`visibleWhen: "data.type == 'grid' || data.type == null"`), so an author
 * editing any other view type could not see or set that bound short of editing
 * the metadata by hand. Two halves, both asserted:
 *
 * - **offer**: for every value of the list-view `type` enum — and for a view
 *   with no `type` yet — some section visible to that type offers `pagination`;
 *   the offer is backed by the door, because every type parses a `pagination`
 *   block clean and keeps it;
 * - **no leak**: the grid-only fields stay hidden from every non-grid type.
 *
 * ## The kind list is read from the enum, never written here
 *
 * A literal list would stay green through a new view type the form hides
 * `pagination` from. The list is the enum on {@link ListViewSchema} — the
 * list-view shape this form lays out, and the one `ViewSchema`'s `list` /
 * `listViews` entries are derived from — with a floor naming the four types
 * the ruling is about, so an empty derivation cannot pass.
 *
 * ## How visibility is read
 *
 * A section's `visibleWhen` is a CEL predicate over the edited record as
 * `data`. `packages/spec` carries no evaluator and must not grow one (no
 * runtime logic in spec), so {@link visibleFor} reads the ONE grammar this form
 * uses — a disjunction of `data.type == '<type>'` / `data.type == null` terms —
 * and THROWS on anything else, naming the predicate. A predicate this pin cannot
 * read fails it loudly instead of being guessed at.
 */

import { describe, it, expect } from 'vitest';

import { viewForm } from './view.form';
import { ListViewSchema } from './view.zod';

type Predicate = string | { dialect?: string; source?: string } | undefined;
type Entry = string | { field?: string; visibleWhen?: Predicate };
type Section = { name?: string; visibleWhen?: Predicate; fields?: Entry[] };

const SECTIONS = (viewForm.sections ?? []) as Section[];

/** The list-view `type` enum, read at runtime. */
const VIEW_TYPES: readonly string[] = (
  ListViewSchema.shape.type as unknown as { unwrap(): { options: readonly string[] } }
).unwrap().options;

/** The view types ruling D names — a floor under the derivation, not the list. */
const RULING_D_TYPES = ['grid', 'kanban', 'gallery', 'timeline'] as const;

/**
 * The fields that are grid-only by design. Named here rather than read from
 * `table_options`, so moving one out of that section is a visible failure, not a
 * silently re-derived list.
 */
const GRID_ONLY_FIELDS = ['resizable', 'compactToolbar', 'rowHeight', 'selection'] as const;

const TERM = /^data\.type\s*==\s*(?:'([a-z_]+)'|(null))$/;

/**
 * Is a predicate true for a record whose `type` is `type` (`undefined` = not
 * set yet)? An absent predicate is always visible.
 */
function visibleFor(predicate: Predicate, type: string | undefined, where: string): boolean {
  if (predicate === undefined) return true;
  const source = typeof predicate === 'string' ? predicate : predicate.source;
  if (typeof predicate !== 'string' && predicate.dialect !== undefined && predicate.dialect !== 'cel') {
    throw new Error(`${where}: this pin reads CEL predicates only, got dialect ${JSON.stringify(predicate.dialect)}`);
  }
  if (typeof source !== 'string') throw new Error(`${where}: predicate has no source: ${JSON.stringify(predicate)}`);
  return source.split('||').map((t) => t.trim()).some((term) => {
    const m = TERM.exec(term);
    if (!m) {
      throw new Error(
        `${where}: this pin cannot read the predicate term ${JSON.stringify(term)} in ${JSON.stringify(source)} — ` +
          'extend visibleFor() to read it; never guess a visibility',
      );
    }
    return m[2] === 'null' ? type === undefined : type === m[1];
  });
}

const fieldName = (e: Entry): string | undefined => (typeof e === 'string' ? e : e.field);

/** The sections (by name) in which `field` is offered AND visible for `type`. */
function offeredTo(field: string, type: string | undefined): string[] {
  const hits: string[] = [];
  for (const section of SECTIONS) {
    const where = `section ${JSON.stringify(section.name)}`;
    if (!visibleFor(section.visibleWhen, type, where)) continue;
    for (const entry of section.fields ?? []) {
      if (fieldName(entry) !== field) continue;
      const own = typeof entry === 'string' ? undefined : entry.visibleWhen;
      if (visibleFor(own, type, `${where} field ${JSON.stringify(field)}`)) hits.push(section.name ?? '(unnamed)');
    }
  }
  return hits;
}

describe('view form — the kind list is the enum', () => {
  it('derives a non-empty type list that contains every type ruling D names', () => {
    expect(VIEW_TYPES.length).toBeGreaterThanOrEqual(RULING_D_TYPES.length);
    for (const t of RULING_D_TYPES) expect(VIEW_TYPES, `the enum lost '${t}'`).toContain(t);
  });
});

describe('view form — `pagination` is offered to every view type', () => {
  it('is offered exactly once in the whole form', () => {
    const entries = SECTIONS.flatMap((s) => (s.fields ?? []).filter((e) => fieldName(e) === 'pagination'));
    expect(entries).toHaveLength(1);
  });

  it.each(VIEW_TYPES.map((t) => [t]))("is visible for type '%s'", (type) => {
    expect(offeredTo('pagination', type), `a '${type}' view cannot reach its row bound in the form`).toHaveLength(1);
  });

  it('is visible for a view whose type is not set yet', () => {
    expect(offeredTo('pagination', undefined)).toHaveLength(1);
  });

  it.each(VIEW_TYPES.map((t) => [t]))("is backed by the door: type '%s' parses a pagination block and keeps it", (type) => {
    const r = ListViewSchema.safeParse({ type, columns: ['name'], pagination: { pageSize: 50 } });
    expect(r.success, JSON.stringify(r.error?.issues ?? '')).toBe(true);
    expect((r.data as { pagination?: unknown }).pagination).toEqual({ pageSize: 50 });
  });
});

describe('view form — grid-only fields stay grid-only', () => {
  it.each(GRID_ONLY_FIELDS.map((f) => [f]))("'%s' is visible for grid and for an unset type", (field) => {
    expect(offeredTo(field, 'grid')).toHaveLength(1);
    expect(offeredTo(field, undefined)).toHaveLength(1);
  });

  const nonGrid = VIEW_TYPES.filter((t) => t !== 'grid');
  it.each(nonGrid.flatMap((t) => GRID_ONLY_FIELDS.map((f) => [f, t])))("'%s' is hidden from type '%s'", (field, type) => {
    expect(offeredTo(field, type)).toEqual([]);
  });
});

describe('view form — the predicate reader refuses what it cannot read', () => {
  it('throws on a term outside its grammar rather than guessing', () => {
    expect(() => visibleFor("data.type != 'grid'", 'kanban', 'probe')).toThrow(/cannot read the predicate term/);
  });
});

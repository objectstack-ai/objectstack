// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #30267 — the view form spells out every composite's children, and each
 * child's hint is the schema's own `.describe()` text.
 *
 * ## Why the children are declared at all
 *
 * `os i18n extract` walks a form field's DECLARED `fields` and nothing else.
 * A composite left to the panel's schema-derived list (`SchemaForm` falls back
 * to `schema.properties` when the form names no children) therefore had no
 * `metadataForms.view.fields['<parent>.<child>']` key for any of its rows: a
 * zh-CN Studio read ~70 English rows under 表格选项 / 分页 / 终端用户控制 /
 * 导航与共享.
 *
 * ## What declaring them costs, pinned here
 *
 *  - **Completeness.** Once a composite declares children the panel renders
 *    exactly those, so a key added to the schema block later would silently
 *    drop out of the panel. Each declared list is held EQUAL to the schema's
 *    live keys — every property except the `retiredKey()` tombstones, which a
 *    form must never offer (the schema-derived list used to render
 *    `navigation.view` and `sharing.type` as editable rows).
 *  - **One English string.** A declared `helpText` replaces the schema
 *    description the panel showed before, so it is held equal to that
 *    description: an English console reads the same hint it read before, and
 *    the two cannot drift apart. A child whose schema has no description
 *    (`navigation.mode`) declares none.
 *  - **Repeater row names.** `userFilters.fields` is enumerated as a repeater;
 *    each row child's `label` is the item schema's `.meta({ title })` — the
 *    column head the panel reads (`repeater-item-titles.test.ts` requires the
 *    titles, this file requires the two equal).
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { viewForm } from './view.form';
import { ViewSchema } from './view.zod';

type Node = Record<string, any>;
type FormField = { field?: string; type?: string; label?: string; helpText?: string; fields?: FormField[] };

const RETIRED_PREFIX = '[REMOVED] ';

/** The list-view JSON Schema, derived the way Studio's view inspector derives it. */
const LIST: Node = (z.toJSONSchema(ViewSchema, { io: 'input', unrepresentable: 'any' }) as Node).properties.list;

function formField(name: string): FormField {
  for (const section of (viewForm.sections ?? []) as Array<{ fields?: FormField[] }>) {
    for (const f of section.fields ?? []) if (f?.field === name) return f;
  }
  throw new Error(`viewForm declares no top-level field \`${name}\``);
}

function liveKeys(props: Record<string, Node>): string[] {
  return Object.entries(props)
    .filter(([, v]) => !String(v?.description ?? '').startsWith(RETIRED_PREFIX))
    .map(([k]) => k);
}

/** The composites this card spelled out, plus the one spelled out before it. */
const COMPOSITES = ['selection', 'pagination', 'userFilters', 'appearance', 'userActions', 'addRecord', 'navigation', 'sharing'] as const;

describe('#30267 — view form composites declare their children', () => {
  it('reads a real schema (control: the derivation is not empty)', () => {
    expect(Object.keys(LIST.properties.userActions.properties)).toContain('editInline');
    expect(LIST.properties.navigation.properties.view.description.startsWith(RETIRED_PREFIX)).toBe(true);
  });

  for (const name of COMPOSITES) {
    it(`${name}: declares exactly the schema's live keys, in a composite`, () => {
      const f = formField(name);
      expect(f.type).toBe('composite');
      const declared = (f.fields ?? []).map((c) => c.field);
      expect(declared.length, `${name} declares no children`).toBeGreaterThan(0);
      expect([...declared].sort()).toEqual(liveKeys(LIST.properties[name].properties).sort());
    });

    it(`${name}: each declared hint is the schema description it replaces`, () => {
      const f = formField(name);
      const props = LIST.properties[name].properties as Record<string, Node>;
      for (const child of f.fields ?? []) {
        expect(child.helpText, `${name}.${child.field}`).toBe(props[child.field!]?.description);
      }
    });
  }

  it('never offers a retired key: navigation.view, sharing.type, addRecord.mode / formView', () => {
    const names = (n: string) => (formField(n).fields ?? []).map((c) => c.field);
    expect(names('navigation')).not.toContain('view');
    expect(names('sharing')).not.toContain('type');
    expect(names('addRecord')).not.toContain('mode');
    expect(names('addRecord')).not.toContain('formView');
  });

  it('top-level rows that gained a hint carry their schema description', () => {
    for (const name of ['resizable', 'compactToolbar', 'rowHeight', 'selection', 'pagination', 'addRecord', 'showRecordCount', 'navigation', 'sharing']) {
      expect(formField(name).helpText, name).toBe(LIST.properties[name].description);
    }
  });

  it('userFilters.fields is a repeater whose row labels are the item schema titles', () => {
    const repeater = (formField('userFilters').fields ?? []).find((c) => c.field === 'fields');
    expect(repeater?.type).toBe('repeater');
    // The inline table it rendered as before it was enumerated.
    expect((repeater as { widget?: string } | undefined)?.widget).toBe('grid');
    const items = LIST.properties.userFilters.properties.fields.items.properties as Record<string, Node>;
    const rows = repeater?.fields ?? [];
    expect(rows.map((r) => r.field).sort()).toEqual(liveKeys(items).sort());
    for (const row of rows) {
      expect(row.label, `userFilters.fields.${row.field}`).toBe(items[row.field!]?.title);
      expect(typeof row.label).toBe('string');
    }
  });
});

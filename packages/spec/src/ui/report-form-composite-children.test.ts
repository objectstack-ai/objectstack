// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #36447 — the report form spells out the children of its two composites,
 * `dateRange` and `exportOptions`, so each row carries its own business label
 * and hint instead of the schema description the panel fell back to
 * ("Dataset dimension (declared `type: 'date'`) the window applies to; …").
 *
 * The shape follows the view form's (#30267, `view-form-composite-children.test.ts`)
 * with one deliberate difference: there each declared hint is held EQUAL to the
 * schema description; here it is not, because the point of these rows is that
 * the panel's words differ from the author documentation the describes are.
 *
 * What declaring children costs, pinned here:
 *
 *  - **Completeness.** Once a composite declares children the panel renders
 *    exactly those, so a key added to the schema block later would silently
 *    drop out of the panel. Each declared list is held EQUAL to the schema's
 *    keys.
 *  - **Every row is named.** Each child declares its own `label` and
 *    `helpText`, so no row of either composite falls back to schema text.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { reportForm } from './report.metadata-form';
import { ReportSchema } from './report.zod';

type Node = Record<string, any>;
type FormField = { field?: string; type?: string; label?: string; helpText?: string; fields?: FormField[] };

/** The report JSON Schema, derived the way Studio's report inspector derives it. */
const REPORT: Node = z.toJSONSchema(ReportSchema, { io: 'input', unrepresentable: 'any' }) as Node;

function formField(name: string): FormField {
  for (const section of (reportForm.sections ?? []) as Array<{ fields?: FormField[] }>) {
    for (const f of section.fields ?? []) if (f?.field === name) return f;
  }
  throw new Error(`reportForm declares no top-level field \`${name}\``);
}

/** A composite's own object schema; `.optional()` may wrap it in a union. */
function objectProps(name: string): Record<string, Node> {
  const node = REPORT.properties?.[name] as Node | undefined;
  const branch = node?.properties ? node : (node?.anyOf ?? node?.oneOf ?? []).find((b: Node) => b?.properties);
  return (branch?.properties ?? {}) as Record<string, Node>;
}

const COMPOSITES = ['dateRange', 'exportOptions'] as const;

describe('#36447 — report form composites declare their children', () => {
  it('reads a real schema (control: the derivation is not empty)', () => {
    expect(Object.keys(objectProps('dateRange'))).toContain('defaultRange');
    expect(Object.keys(objectProps('exportOptions'))).toContain('formats');
  });

  for (const name of COMPOSITES) {
    it(`${name}: declares exactly the schema's keys, in a composite`, () => {
      const f = formField(name);
      expect(f.type).toBe('composite');
      const declared = (f.fields ?? []).map((c) => c.field);
      expect(declared.length, `${name} declares no children`).toBeGreaterThan(0);
      expect([...declared].sort()).toEqual(Object.keys(objectProps(name)).sort());
    });

    it(`${name}: every child names itself — a label and a hint of its own`, () => {
      for (const child of formField(name).fields ?? []) {
        expect(child.label, `${name}.${child.field} label`).toMatch(/\S/);
        expect(child.helpText, `${name}.${child.field} helpText`).toMatch(/\S/);
      }
    });
  }

  it('the Description row has its own hint, not the shared I18nLabel description', () => {
    const hint = formField('description').helpText;
    expect(hint).toMatch(/\S/);
    expect(hint).not.toBe(REPORT.properties?.description?.description);
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20221 — form `layout` sheds `inline` and `grid` (ADR-0049 enforce-or-remove).
 *
 * Both surfaces that declared the four-arm enum — the `object-form` page
 * component (`ObjectFormPropsSchema.layout`) and the form view
 * (`FormViewSchema.layout`) — now accept exactly `vertical | horizontal`. No
 * renderer ever gave the two retired values a behaviour of their own (the
 * measurement is recorded beside the prescriptions, `OBJECT_FORM_LAYOUT_RETIRED`
 * in component.zod.ts and `FORM_VIEW_LAYOUT_RETIRED` in view.zod.ts), so a
 * green parse for either was a declared value the renderer threw away.
 *
 * What this file pins, per door:
 *
 * 1. **The refusal carries the prescription.** `invalid_value` at `layout`,
 *    naming the removed value, the value to write instead, and — for `grid` —
 *    `columns`, the key multi-column actually lives under. A never-vocabulary
 *    value keeps zod's own enum refusal (the map is keyed on `issue.input`, so
 *    only a value that used to be legal is told it "was removed").
 * 2. **The surviving arms are the controls.** `vertical` and `horizontal` parse
 *    fully green on every door the refusal is asserted on, so a red here is the
 *    narrowing and not a broken door.
 * 3. **The D2 conversion rewrites both arms to `vertical` and keeps `columns`**,
 *    and what it produces parses green on the door that refused the input.
 * 4. **The D3 family entry and the chain step are registered.**
 */

import { describe, expect, it } from 'vitest';

import { applyConversions } from '../conversions/apply.js';
import { CONVERSIONS_BY_MAJOR } from '../conversions/registry.js';
import { applyConversionsToStoredItem } from '../conversions/stored.js';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry.js';
import { ComponentPropsMap, ObjectFormPropsSchema } from './component.zod.js';
import { FormViewSchema, VIEW_METADATA_MEMBERS, ViewSchema } from './view.zod.js';

const CONVERSION_ID = 'form-layout-inline-grid-to-vertical';
const SEMANTIC_ID = 'ui-form-layout-inline-grid-retired';

interface Door {
  name: string;
  /** Parse a document whose `layout` is the given value; the path of `layout` in it. */
  parse: (layout: string) => { success: boolean; error?: { issues: readonly ZodIssueLike[] } };
  layoutPath: readonly (string | number)[];
}

interface ZodIssueLike {
  code: string;
  path: readonly PropertyKey[];
  message: string;
}

const DOORS: readonly Door[] = [
  {
    name: 'ObjectFormPropsSchema',
    parse: (layout) => ObjectFormPropsSchema.safeParse({ objectName: 'crm_lead', layout }),
    layoutPath: ['layout'],
  },
  {
    name: "ComponentPropsMap['object-form'] (the props gate's dispatch)",
    parse: (layout) => ComponentPropsMap['object-form'].safeParse({ objectName: 'crm_lead', layout }),
    layoutPath: ['layout'],
  },
  {
    name: 'FormViewSchema',
    parse: (layout) => FormViewSchema.safeParse({ type: 'simple', layout }),
    layoutPath: ['layout'],
  },
  {
    name: 'ViewSchema.formViews.* (a container)',
    parse: (layout) => ViewSchema.safeParse({ formViews: { quick: { type: 'simple', layout } } }),
    layoutPath: ['formViews', 'quick', 'layout'],
  },
  {
    // The flattened form overlay spreads `FormViewSchema`'s shape, so the
    // narrowing reaches it without an edit of its own.
    name: 'VIEW_METADATA_MEMBERS.formOverlay (the flattened form overlay)',
    parse: (layout) => VIEW_METADATA_MEMBERS.formOverlay.safeParse({
      object: 'crm_lead',
      viewKind: 'form',
      type: 'simple',
      layout,
    }),
    layoutPath: ['layout'],
  },
];

describe('form `layout` — the retired arms are refused with the prescription', () => {
  for (const door of DOORS) {
    describe(door.name, () => {
      it("'grid' → refused, prescribing 'vertical' and naming `columns` for multi-column", () => {
        const result = door.parse('grid');
        expect(result.success).toBe(false);
        const issue = result.error!.issues.find((i) => i.path.join('.') === door.layoutPath.join('.'));
        expect(issue, 'an issue at the layout path').toBeDefined();
        expect(issue!.code).toBe('invalid_value');
        expect(issue!.message).toContain("'grid' was removed");
        expect(issue!.message).toContain("Write 'vertical'");
        expect(issue!.message).toContain('set `columns`');
        expect(issue!.message).toContain('ADR-0049');
        expect(issue!.message).toContain('Run `os migrate meta --from 17` to list the mechanical edits');
      });

      it("'inline' → refused, prescribing 'vertical'", () => {
        const result = door.parse('inline');
        expect(result.success).toBe(false);
        const issue = result.error!.issues.find((i) => i.path.join('.') === door.layoutPath.join('.'));
        expect(issue, 'an issue at the layout path').toBeDefined();
        expect(issue!.code).toBe('invalid_value');
        expect(issue!.message).toContain("'inline' was removed");
        expect(issue!.message).toContain("Write 'vertical'");
        expect(issue!.message).toContain('Run `os migrate meta --from 17` to list the mechanical edits');
      });

      it('a never-vocabulary value keeps zod’s own enum refusal — no retirement prose', () => {
        const result = door.parse('diagonal');
        expect(result.success).toBe(false);
        const issue = result.error!.issues.find((i) => i.path.join('.') === door.layoutPath.join('.'));
        expect(issue!.code).toBe('invalid_value');
        expect(issue!.message).not.toContain('was removed');
      });

      it("controls: 'vertical' and 'horizontal' parse fully green", () => {
        expect(door.parse('vertical').success).toBe(true);
        expect(door.parse('horizontal').success).toBe(true);
      });
    });
  }

  it('the two schemas speak the same two-arm vocabulary, each under its own surface name', () => {
    const objectForm = ObjectFormPropsSchema.safeParse({ layout: 'grid' });
    const formView = FormViewSchema.safeParse({ layout: 'grid' });
    expect(objectForm.success).toBe(false);
    expect(formView.success).toBe(false);
    expect(objectForm.error!.issues[0]!.message).toContain('`object-form` `layout` enum');
    expect(formView.error!.issues[0]!.message).toContain('form view `layout` enum');
  });
});

describe(`D2 conversion \`${CONVERSION_ID}\``, () => {
  const conversion = CONVERSIONS_BY_MAJOR[18]!.find((c) => c.id === CONVERSION_ID);

  it('is registered under protocol 18 and retired from the load path', () => {
    expect(conversion).toBeDefined();
    expect(conversion!.toMajor).toBe(18);
    // The enums refuse live authors; the entry replays for stored rows,
    // assembled artifacts and `os migrate meta` only.
    expect(conversion!.retiredFromLoadPath).toBe(true);
  });

  it("rewrites both arms to 'vertical' on an `object-form` and keeps `columns`, and the result parses", () => {
    const stack = {
      pages: [{
        name: 'intake_forms',
        regions: [{
          name: 'main',
          components: [
            { type: 'object-form', properties: { objectName: 'crm_lead', layout: 'grid', columns: 2 } },
            { type: 'object-form', properties: { objectName: 'crm_lead', layout: 'inline' } },
          ],
        }],
      }],
    };
    const out = applyConversions(structuredClone(stack), { includeRetired: true }) as typeof stack;
    const [gridForm, inlineForm] = out.pages[0]!.regions[0]!.components;
    expect(gridForm!.properties).toEqual({ objectName: 'crm_lead', layout: 'vertical', columns: 2 });
    expect(inlineForm!.properties).toEqual({ objectName: 'crm_lead', layout: 'vertical' });
    // The input was refused at the props door; the rewrite is accepted there.
    expect(ObjectFormPropsSchema.safeParse(stack.pages[0]!.regions[0]!.components[0]!.properties).success).toBe(false);
    expect(ObjectFormPropsSchema.safeParse(gridForm!.properties).success).toBe(true);
    expect(ObjectFormPropsSchema.safeParse(inlineForm!.properties).success).toBe(true);
  });

  it('does NOT apply on the default load path — the schema teaches the live author instead', () => {
    const stack = {
      pages: [{
        name: 'intake_forms',
        regions: [{ name: 'main', components: [{ type: 'object-form', properties: { layout: 'grid' } }] }],
      }],
    };
    const out = applyConversions(structuredClone(stack)) as typeof stack;
    expect(out.pages[0]!.regions[0]!.components[0]!.properties.layout).toBe('grid');
  });

  it("a stored form view row replays clean: 'grid' → 'vertical', `columns` kept, and the row parses", () => {
    const row = { object: 'crm_lead', form: { type: 'simple', layout: 'grid', columns: 3 } };
    expect(ViewSchema.safeParse(row).success).toBe(false);
    const replayed = applyConversionsToStoredItem('view', structuredClone(row));
    expect(replayed.form).toEqual({ type: 'simple', layout: 'vertical', columns: 3 });
    expect(ViewSchema.safeParse(replayed).success).toBe(true);
  });

  it("a stored flattened form overlay replays clean: 'inline' → 'vertical', and the overlay parses", () => {
    const row = { object: 'crm_lead', viewKind: 'form', type: 'simple', layout: 'inline' };
    expect(VIEW_METADATA_MEMBERS.formOverlay.safeParse(row).success).toBe(false);
    const replayed = applyConversionsToStoredItem('view', structuredClone(row));
    expect(replayed.layout).toBe('vertical');
    expect(VIEW_METADATA_MEMBERS.formOverlay.safeParse(replayed).success).toBe(true);
  });

  it("leaves the surviving arm, and the same key on a non-`object-form` component, untouched", () => {
    const stack = {
      pages: [{
        name: 'intake_forms',
        regions: [{
          name: 'main',
          components: [
            { type: 'object-form', properties: { layout: 'horizontal' } },
            { type: 'element:custom', properties: { layout: 'grid' } },
          ],
        }],
      }],
    };
    const out = applyConversions(structuredClone(stack), { includeRetired: true });
    expect(out).toEqual(stack);
  });
});

describe('D3: the family entry and the chain step are registered', () => {
  const step = MIGRATIONS_BY_MAJOR[18]!;

  it(`the protocol-18 step wires \`${CONVERSION_ID}\``, () => {
    expect(step.conversionIds).toContain(CONVERSION_ID);
  });

  it(`carries ONE semantic entry for the family, \`${SEMANTIC_ID}\`, naming \`columns\` as the replacement`, () => {
    const entries = step.semantic.filter((e) => e.id === SEMANTIC_ID);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry!.replacement).toContain('`columns`');
    expect(entry!.reason).toContain(CONVERSION_ID);
    expect(entry!.acceptanceCriteria).toContain("`layout: 'inline' | 'grid'`");
  });
});

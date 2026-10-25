/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ADR-0080 public blocks that `@objectstack/spec` declares a
 * `ComponentPropsMap` row for have a zod arm in `AnyComponentSchema`
 * (objectui#10872, batch 1).
 *
 * ## The defect these pin
 *
 * `page:header`, `record:details`, `element:text` and the rest of the curated
 * public vocabulary (`PUBLIC_BLOCKS`, `@object-ui/core`) are registered,
 * documented and declared by the spec — and `AnyComponentSchema` carried no arm
 * for any of them, so `safeValidateSchema` refused every document naming one
 * with `invalid_union` at `type`, and `objectui validate` could not pass a page
 * built from the platform's own public blocks.
 *
 * ## What "matching its declared props" means here
 *
 * A `ComponentPropsMap` row declares a page component's props BAG — the
 * `properties` member of the spec's `PageComponentSchema` — so each arm
 * declares `properties` as that row, by reference (`../zod/public-blocks.zod.ts`
 * says why). The rows below therefore measure the arm against the INSTALLED
 * spec on every run rather than against a transcribed key list: a row the spec
 * widens or narrows moves these readings with it.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ComponentPropsMap, PageComponentSchema } from '@objectstack/spec/ui';

import {
  PublicBlockComponentSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';
import * as zodBarrel from '../zod/index.zod.js';
import { stripImportedDefaults } from '../zod/imported-defaults.js';

/**
 * A spec-valid props bag per armed block — each one is parsed by the spec's own
 * row below before it is used, so a fixture that stops being spec-valid fails
 * as a FIXTURE, not as the arm.
 */
const VALID_BAG: Readonly<Record<string, Record<string, unknown>>> = {
  'page:header': { title: 'Account', subtitle: 'Customer' },
  'page:tabs': { items: [{ label: 'Details', children: [] }] },
  'page:card': { title: 'Summary', bordered: false },
  'page:accordion': { items: [{ label: 'More', children: [] }] },
  'page:section': { children: [] },
  'page:footer': { children: [] },
  'page:sidebar': { children: [] },
  'record:details': { columns: '2', sections: [{ label: 'Contact', fields: ['email'] }] },
  'record:highlights': { fields: ['name', 'status'] },
  'record:related_list': { objectName: 'task', relationshipField: 'account', columns: ['subject'] },
  'record:path': { statusField: 'status' },
  'record:activity': { limit: 10 },
  'record:discussion': { collapsible: true },
  'record:history': { limit: 20 },
  'record:quick_actions': { actionNames: ['edit'] },
  'record:reference_rail': { entries: [{ objectName: 'contact', relationshipField: 'account' }] },
  'record:alert': { severity: 'warning', title: 'Overdue' },
  // objectui#10872 — the row `@objectstack/spec` 17.6.0 carries; its own
  // readings are pinned in `./record-line-items-arm-10872.test.ts`.
  'record:line_items': { childObject: 'order_line', relationshipField: 'order', columns: [{ name: 'qty' }] },
  'element:text': { content: 'Hello' },
  // objectui#10872 batch 2 — the bag that names its own `object`; the
  // `dataSource` waiver is pinned in `./element-number-arm-10872.test.ts`.
  // No flat query key: `@objectstack/spec` 18 retired `object` / `filter` here (objectui#12030).
  'element:number': { aggregate: 'count' },
  'element:button': { label: 'Go' },
  'element:divider': {},
  // objectui#10872 batch 4 — the six rows `@objectstack/spec` 17.5.0 carries;
  // their own readings are pinned in `./held-public-block-arms-10872.test.ts`.
  'element:definition-list': { items: [{ term: 'Owner', description: 'Ada' }], columns: 2 },
  // No flat query key: `@objectstack/spec` 18 retired `object` / `filter` / `sort` / `limit` here (objectui#12030).
  'element:repeater': { titleField: 'subject', fields: ['subject', { field: 'status' }] },
  'action:button': { label: 'Open details', actionType: 'url', target: '/users/ada' },
  'action:icon': { icon: 'pencil', label: 'Edit', actionType: 'url', target: '/users/ada/edit' },
  'action:group': { actions: [{ name: 'edit', label: 'Edit' }], display: 'dropdown' },
  'action:menu': { actions: [{ name: 'archive', label: 'Archive' }] },
};

/** The armed literals, in the order `VALID_BAG` lists them. */
const ARMED = Object.keys(VALID_BAG);

/** The spec's row for one block, as the published map carries it. */
const rowOf = (type: string): z.ZodType =>
  (ComponentPropsMap as unknown as Record<string, z.ZodType>)[type];

/** The arm `PublicBlockComponentSchema` selects for one literal. */
function armOf(type: string): z.ZodObject {
  const options = (PublicBlockComponentSchema as unknown as { options: z.ZodObject[] }).options;
  const arm = options.find((option) => (option.shape.type as z.ZodLiteral).value === type);
  if (!arm) throw new Error(`no public-block arm for ${type}`);
  return arm;
}

/** The arm's `properties` member with its `.optional()` peeled off. */
function bagOf(type: string): z.ZodType {
  return (armOf(type).shape.properties as z.ZodOptional).unwrap() as z.ZodType;
}

const keysOf = (schema: z.ZodType): string[] =>
  Object.keys((schema as unknown as { shape?: Record<string, unknown> }).shape ?? {}).sort();

/**
 * The keys an `unrecognized_keys` issue names, wherever it sits — including
 * inside the per-arm issue lists of an `invalid_union` (a child slot is a
 * plain union, so a refused child reports one level down).
 */
function refusedKeys(result: { success: boolean; error?: { issues: z.core.$ZodIssue[] } }): string[] {
  if (result.success) return [];
  const collect = (issues: readonly z.core.$ZodIssue[]): string[] =>
    issues.flatMap((issue) => {
      if (issue.code === 'unrecognized_keys') return issue.keys;
      if (issue.code === 'invalid_union') return issue.errors.flatMap((arm) => collect(arm));
      return [];
    });
  return collect(result.error!.issues);
}

describe('the public blocks with a spec row validate (objectui#10872)', () => {
  it('the union arms exactly the blocks this file measures — no arm without a row here', () => {
    const literals = (PublicBlockComponentSchema as unknown as { options: z.ZodObject[] }).options
      .map((option) => (option.shape.type as z.ZodLiteral).value as string)
      .sort();
    expect(literals).toEqual([...ARMED].sort());
  });

  it.each(ARMED)('%s: the minimal document is accepted on both faces', (type) => {
    expect(safeValidateSchema({ type }).success).toBe(true);
    expect(StrictAnyComponentSchema.safeParse({ type }).success).toBe(true);
    // The spec's own parse face takes a node with no bag too — `properties` is
    // optional there, which is what the arm's optional bag restates.
    expect(PageComponentSchema.safeParse({ type }).success).toBe(true);
  });

  it.each(ARMED)('%s: a spec-valid props bag is accepted on both faces', (type) => {
    const properties = VALID_BAG[type];
    // Fixture control: the bag is valid by the spec's own row.
    expect(rowOf(type).safeParse(properties).success, `${type} fixture is not spec-valid`).toBe(true);
    expect(safeValidateSchema({ type, properties }).success).toBe(true);
    expect(StrictAnyComponentSchema.safeParse({ type, properties }).success).toBe(true);
  });

  it('a page built from `page:header`, `record:details` and `element:text` validates', () => {
    const page = {
      type: 'page',
      title: 'Account',
      children: [
        { type: 'page:header', properties: { title: 'Account' } },
        { type: 'record:details' },
        { type: 'element:text', properties: { content: 'Hello' } },
      ],
    };
    expect(safeValidateSchema(page).success).toBe(true);
    expect(StrictAnyComponentSchema.safeParse(page).success).toBe(true);
  });

  it('each arm is a named export of the barrel', () => {
    const barrel = zodBarrel as unknown as Record<string, unknown>;
    for (const type of ARMED) {
      expect(Object.values(barrel), type).toContain(armOf(type));
    }
  });
});

describe('the bag is the spec row, read by reference (objectui#10872)', () => {
  it.each(ARMED)('%s: the bag declares exactly the row\'s members', (type) => {
    expect(rowOf(type), `${type} has no ComponentPropsMap row`).toBeDefined();
    expect(keysOf(bagOf(type))).toEqual(keysOf(rowOf(type)));
  });

  // `element:divider` is restated (below). `element:number`'s and
  // `element:repeater`'s bags were their rows with `object` alone made optional
  // — the spec's `dataSource` waiver — until `@objectstack/spec` 18 retired that
  // `object` (objectui#12030); both are their rows by reference again.
  it.each(ARMED.filter((type) => type !== 'element:divider'))(
    '%s: the bag is the spec\'s own row object wherever the import boundary has nothing to strip',
    (type) => {
      const row = rowOf(type);
      if (stripImportedDefaults(row) === row) {
        // The same schema, compared by DEFINITION (objectui#10872 batch 4):
        // `@objectstack/spec` 17.5.0 publishes some rows as lazy proxies whose
        // methods run on the real schema, so the bag's `.optional()` wraps the
        // object behind the proxy, never the proxy itself. A non-proxy row
        // answers the same way: one object, one definition.
        expect((bagOf(type) as unknown as { _zod: { def: unknown } })._zod.def)
          .toBe((row as unknown as { _zod: { def: unknown } })._zod.def);
      } else {
        // The row carries a spec default the boundary removes (objectui#8317):
        // the bag is the stripped clone, which answers the fixture as the row does.
        expect(bagOf(type)).not.toBe(row);
        expect(bagOf(type).safeParse(VALID_BAG[type]).success).toBe(true);
      }
    },
  );

  it('an undeclared member inside the bag is refused on the TOLERANT face, by name', () => {
    const result = safeValidateSchema({ type: 'record:details', properties: { inventedKey10872: true } });
    expect(result.success).toBe(false);
    expect(refusedKeys(result)).toContain('inventedKey10872');
    expect(result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))).toContain('properties');
    // Control: the spec's own row refuses the same key.
    expect(rowOf('record:details').safeParse({ inventedKey10872: true }).success).toBe(false);
  });

  it('an undeclared member on the node is refused on the STRICT face, by name', () => {
    const document = { type: 'record:details', inventedFlat10872: 1 };
    const result = StrictAnyComponentSchema.safeParse(document);
    expect(result.success).toBe(false);
    expect(refusedKeys(result)).toEqual(['inventedFlat10872']);
    // Control: the tolerant face passes an undeclared node key through, as it
    // does on every arm — the refusal above is the strict face's.
    expect(safeValidateSchema(document).success).toBe(true);
  });

  it('a value the spec row refuses is refused at the member, on both faces', () => {
    const document = { type: 'element:text', properties: { content: 'Hi', variant: 'shout' } };
    const result = safeValidateSchema(document);
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((issue) => issue.path.join('.')))
      .toContain('properties.variant');
    expect(StrictAnyComponentSchema.safeParse(document).success).toBe(false);
    // Control: the fixed value parses.
    expect(safeValidateSchema({ type: 'element:text', properties: { content: 'Hi', variant: 'body' } }).success)
      .toBe(true);
  });

  it('a key the spec retired travels with the row — refused at the member', () => {
    const document = { type: 'page:card', properties: { title: 'Summary', actions: ['edit'] } };
    const result = safeValidateSchema(document);
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((issue) => issue.path.join('.')))
      .toContain('properties.actions');
    // Control: the spec's own row refuses it too.
    expect(rowOf('page:card').safeParse({ title: 'Summary', actions: ['edit'] }).success).toBe(false);
  });

  it('`page:tabs` refuses an authored `onTabChange` by name — a runtime slot, not a prop (objectui#6124)', () => {
    const result = safeValidateSchema({ type: 'page:tabs', onTabChange: { action: 'toast' } });
    expect(result.success).toBe(false);
    const issue = result.success ? undefined : result.error.issues.find((i) => i.path.join('.') === 'onTabChange');
    expect(issue?.code).toBe('custom');
    expect(issue?.message).toContain('RUNTIME SLOT');
    // Control: the same node without the key parses.
    expect(safeValidateSchema({ type: 'page:tabs' }).success).toBe(true);
  });

  it('a public block nested in a page is judged by its own arm, not by the base keys', () => {
    const page = {
      type: 'page',
      children: [{ type: 'record:highlights', properties: { fields: ['name'], inventedNested10872: 1 } }],
    };
    const result = safeValidateSchema(page);
    expect(result.success).toBe(false);
    expect(refusedKeys(result)).toContain('inventedNested10872');
  });
});

describe('`element:divider` — the one row restated, pinned to the spec (objectui#10872)', () => {
  it('declares no member, as the spec row declares none', () => {
    expect(keysOf(rowOf('element:divider'))).toEqual([]);
    expect(keysOf(bagOf('element:divider'))).toEqual([]);
  });

  it('accepts and refuses exactly what the spec row does', () => {
    for (const probe of [{}, { spacing: 'lg' }, { className: 'my-8' }, null, 'x']) {
      expect(bagOf('element:divider').safeParse(probe).success, JSON.stringify(probe))
        .toBe(rowOf('element:divider').safeParse(probe).success);
    }
    // Non-vacuity: the probes above include both verdicts.
    expect(rowOf('element:divider').safeParse({}).success).toBe(true);
    expect(rowOf('element:divider').safeParse({ spacing: 'lg' }).success).toBe(false);
  });
});

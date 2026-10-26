/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A public block's prop written FLAT on the node, instead of in its
 * `properties` bag, is refused by name on both faces (objectui#10872,
 * batch 10).
 *
 * ## The defect these pin
 *
 * Every public-block arm declares `properties` as the block's
 * `@objectstack/spec` `ComponentPropsMap` row. The same member written on the
 * node itself was not judged against that row:
 *
 *   - a key the node base (`BaseSchema`) does not declare —
 *     `{ "type": "record:details", "columns": "2" }` — passed the tolerant face
 *     (`safeValidateSchema`) UNJUDGED, and the
 *     strict authoring face refused it only as an unnamed `unrecognized_keys`;
 *   - a key the base does declare (`visible`, `disabled`, `name`,
 *     `description`, `data`) passed BOTH faces, judged by the base's own type.
 *
 * The spec's own page component refuses every one of them as mis-layered
 * (ADR-0089 D3a), and triage's answer A on objectui#10872 makes the bag the
 * contract ("A flat channel in objectui's arms is a second dialect: `objectui
 * validate` would accept what `os validate` refuses"). So `flatPropRefusals`
 * (`../zod/public-blocks.zod.ts`) refuses each row member written flat, at its
 * own path, naming `properties.KEY`.
 *
 * ## What is read, and against what
 *
 * The arms are read off the live unions and their rows off each arm's own
 * `properties` member, so an arm or a row member that lands later is covered
 * the day it lands. The node-level keys the spec's page component declares
 * (which a flat refusal must leave alone) are read off the INSTALLED spec's
 * shape, never transcribed here: the module transcribes them, and this file is
 * what notices when the two part.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { PageComponentSchema } from '@objectstack/spec/ui';

import {
  ObjectQLPublicBlockComponentSchema,
  PublicBlockComponentSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';

type Issue = { code: string; path: PropertyKey[]; message: string; keys?: string[]; errors?: Issue[][] };
type Result = { success: boolean; error?: { issues: z.core.$ZodIssue[] } };
type Judge = (document: unknown) => Result;

const FACES: ReadonlyArray<readonly [string, Judge]> = [
  ['tolerant', (document) => safeValidateSchema(document)],
  ['strict', (document) => StrictAnyComponentSchema.safeParse(document)],
];

/** Every issue, union branches unfolded and paths made absolute. */
const allIssues = (issues: Issue[] | undefined, prefix: PropertyKey[] = []): Issue[] =>
  (issues ?? []).flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    return [{ ...issue, path }, ...(issue.errors ?? []).flatMap((branch) => allIssues(branch, path))];
  });
const issuesOf = (result: Result): Issue[] => allIssues(result.error?.issues as unknown as Issue[] | undefined);
const unrecognized = (result: Result): string[] =>
  issuesOf(result).flatMap((issue) => (issue.code === 'unrecognized_keys' ? issue.keys ?? [] : []));
/** The keys refused BY NAME on the node itself: an issue at a one-segment path. */
const namedAtNode = (result: Result): Issue[] =>
  issuesOf(result).filter((issue) => issue.code === 'invalid_type' && issue.path.length === 1);

/** The installed spec page component's node-level keys, read off its own shape. */
function specNodeKeys(): string[] {
  let schema = PageComponentSchema as unknown as { shape?: Record<string, unknown>; _zod: { def: Record<string, unknown> } };
  for (let depth = 0; depth < 6 && !schema.shape; depth++) {
    const def = schema._zod.def;
    if (def.type === 'pipe') schema = def.in as typeof schema;
    else if (def.type === 'lazy') schema = (def.getter as () => typeof schema)();
    else break;
  }
  if (!schema.shape) throw new Error('could not reach the shape of the installed PageComponentSchema');
  return Object.keys(schema.shape);
}
const SPEC_NODE_KEYS = new Set(specNodeKeys());

/** Every public-block arm, by its `type` literal. */
const ARMS: ReadonlyMap<string, z.ZodObject> = new Map(
  [
    ...(PublicBlockComponentSchema as unknown as { options: z.ZodObject[] }).options,
    ...(ObjectQLPublicBlockComponentSchema as unknown as { options: z.ZodObject[] }).options,
  ].map((arm) => [(arm.shape.type as z.ZodLiteral).value as string, arm]),
);

/**
 * The arms whose flat spelling was refused by name BEFORE this batch, each by
 * its own map: objectui#10859 batches 4 to 6 and objectui#11276. Read for the
 * shared invariant below, not re-pinned.
 */
const EARLIER = new Set(['object-form', 'object-map', 'object-gantt', 'object-chart']);

/**
 * The row of an arm: its `properties` member with `.optional()` peeled off. Two
 * arms (objectui#11440's `object-pivot` and `embeddable-form`) require their
 * bag, so their member is the bag itself.
 */
const rowOf = (arm: z.ZodObject): z.ZodObject => {
  const member = arm.shape.properties as z.ZodOptional | z.ZodObject;
  return (member._zod.def.type === 'optional' ? (member as z.ZodOptional).unwrap() : member) as z.ZodObject;
};

/** Does this member refuse every value — the shape of a `z.never` retirement? */
const isNeverMember = (member: unknown): boolean => {
  const def = (member as { _zod: { def: { type: string; innerType?: { _zod: { def: { type: string } } } } } })._zod.def;
  return (def.type === 'optional' ? def.innerType!._zod.def.type : def.type) === 'never';
};

/** The message a member gives any value: the parse-time issue its refusal carries. */
const messageOf = (member: unknown): string =>
  (member as z.ZodType).safeParse('x').error?.issues[0]?.message ?? '';

/**
 * One known-good bag per arm this batch covers — batch 1's `VALID_BAG` rows,
 * plus rows that put the base-declared row keys (`visible`, `disabled`, `name`,
 * `description`, `data`) in play. Each parses on both faces as written.
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
  'record:activity': { limit: 10, showCompleted: true },
  'record:discussion': { collapsible: true },
  'record:history': { limit: 20 },
  'record:quick_actions': { actionNames: ['edit'] },
  'record:reference_rail': { entries: [{ objectName: 'contact', relationshipField: 'account' }] },
  'record:alert': { severity: 'warning', title: 'Overdue', visible: true },
  'record:line_items': {
    childObject: 'order_line',
    relationshipField: 'order',
    columns: [{ name: 'qty', type: 'number' }],
    title: 'Lines',
    readonly: false,
    limit: 50,
  },
  'element:text': { content: 'Hello' },
  // No flat query key: `@objectstack/spec` 18 retired `object` / `filter` here (objectui#12030).
  'element:number': { aggregate: 'count' },
  'element:button': { label: 'Go', disabled: true },
  'element:divider': {},
  'element:definition-list': { items: [{ term: 'Owner', description: 'Ada' }], columns: 2 },
  // No flat query key: `@objectstack/spec` 18 retired `object` / `filter` / `sort` / `limit` here (objectui#12030).
  'element:repeater': { titleField: 'subject', fields: ['subject', { field: 'status' }] },
  'action:button': {
    name: 'open_details',
    label: 'Open details',
    actionType: 'url',
    target: '/users/ada',
    description: 'Opens the record',
    visible: true,
    disabled: false,
  },
  'action:icon': { icon: 'pencil', label: 'Edit', actionType: 'url', target: '/users/ada/edit', visible: true },
  'action:group': { actions: [{ name: 'edit', label: 'Edit' }], display: 'dropdown', visible: true },
  'action:menu': { actions: [{ name: 'archive', label: 'Archive' }], visible: true },
  'object-metric': { objectName: 'order', label: 'Orders', description: 'Open orders', aggregate: { function: 'count' } },
  'object-master-detail-form': { objectName: 'order', mode: 'create', title: 'New order', submitText: 'Save' },
  'object-timeline': { objectName: 'task', limit: 5, data: [] },
  // objectui#11276 (the `object-grid` batch): the authored `object-grid` arm
  // spreads this helper over its row, so it is covered here like the three
  // ObjectQL blocks above; `data` is the base-declared row key in play.
  'object-grid': { objectName: 'task', title: 'Tasks', columns: ['subject'], data: { provider: 'object', object: 'task' } },
  // objectui#11440: the two Tier A blocks armed with a bag of their
  // registration inputs spread this helper over that bag; `title` and
  // `description` are the keys a flat node shares with the node base.
  'object-pivot': { objectName: 'deal', title: 'Pipeline', rowField: 'stage', columnField: 'owner', valueField: 'amount' },
  'embeddable-form': { formId: 'contact-us', objectName: 'lead', title: 'Contact us', description: 'We reply within a day' },
  // objectui#12670: the authored page `list-view` arm spreads this helper over its bag, the
  // `ListViewSchema` mirror's own members; `data`, `name` and `description` are the keys a flat
  // node shares with the node base. The bag's `type` (the list kind) is left out here: written
  // flat it is the node's own `type`, the registry key, so `flattened` below could not carry it.
  'list-view': {
    data: { provider: 'object', object: 'deal' },
    name: 'open_deals',
    label: 'Open deals',
    description: 'Deals not yet closed',
    columns: ['name', 'amount'],
    kanban: { groupByField: 'stage' },
  },
};
const COVERED = Object.keys(VALID_BAG);

/**
 * Bag members an arm refuses flat with its OWN refusal, declared after the spread — the
 * helper's "whatever the arm declares AFTER the spread" — rather than the generated one:
 * the page `list-view`'s five runtime slots (objectui#12670). `ListView` reads each of them,
 * so a flat one is refused as the slot it is, never pointed at a bag member.
 */
const OWN_FLAT_REFUSALS: Readonly<Record<string, readonly string[]>> = {
  'list-view': ['onAddRecord', 'onBulkAction', 'onDensityChange', 'onNavigate', 'onPageSizeChange'],
};
const ownFlatRefusal = (type: string, key: string): boolean => (OWN_FLAT_REFUSALS[type] ?? []).includes(key);

/** The arms whose bag is REQUIRED — its registration-required members live in it (objectui#11440). */
const REQUIRES_BAG: ReadonlySet<string> = new Set(['object-pivot', 'embeddable-form']);

/** The node with its bag hoisted flat — every bag key written on the node itself. */
const flattened = (type: string): Record<string, unknown> => ({ type, ...VALID_BAG[type] });

/** The keys of `bag` a flat refusal owes: everything the spec does not declare on the node. */
const owedRefusals = (keys: readonly string[]): string[] => keys.filter((key) => !SPEC_NODE_KEYS.has(key)).sort();

describe('objectui#10872 batch 10 — the population is read off the unions', () => {
  it('every public-block arm is either covered here or refused its flat spelling by an earlier batch', () => {
    const live = [...ARMS.keys()].filter((type) => !EARLIER.has(type)).sort();
    expect(live).toEqual([...COVERED].sort());
    // Non-vacuity: the four public-block families are all in the population.
    for (const type of ['page:header', 'record:details', 'element:text', 'action:button', 'object-metric']) {
      expect(COVERED, type).toContain(type);
    }
  });

  it('the spec page component\'s node-level keys are read off the installed spec (lit control)', () => {
    // `label`, the key `object-gantt` leaves on the node for the same reason,
    // and `properties` itself must be among them, or the read went wrong.
    expect(SPEC_NODE_KEYS.has('label')).toBe(true);
    expect(SPEC_NODE_KEYS.has('properties')).toBe(true);
    expect(SPEC_NODE_KEYS.has('actionType')).toBe(false);
  });
});

describe('objectui#10872 batch 10 — each row member written flat is refused by name, on both faces', () => {
  const CASES = COVERED.flatMap((type) =>
    owedRefusals(Object.keys(rowOf(ARMS.get(type)!).shape))
      .filter((key) => !ownFlatRefusal(type, key))
      .map((key) => [`${type}.${key}`, type, key] as const),
  );

  it('the population of row members is not empty (non-vacuity)', () => {
    expect(CASES.length).toBeGreaterThan(100);
  });

  it.each(CASES)('%s', (_label, type, key) => {
    const arm = ARMS.get(type)!;
    const retired = isNeverMember(rowOf(arm).shape[key]);
    for (const [face, judge] of FACES) {
      for (const value of ['x', 1, true, {}, []]) {
        const result = judge({ type, [key]: value });
        expect(result.success, `${face} ${JSON.stringify(value)}`).toBe(false);
        const issue = issuesOf(result).find((i) => i.path.length === 1 && i.path[0] === key);
        expect(issue?.code, `${face} ${JSON.stringify(value)}`).toBe('invalid_type');
        if (!retired) expect(issue?.message, face).toContain(`\`properties.${key}\``);
      }
    }
  });
});

describe('objectui#10872 batch 10 — every arm: the flat node is refused, the bag node parses', () => {
  it.each(COVERED)('%s — RED: its known-good bag written flat is refused by exactly the owed keys, each naming its bag member', (type) => {
    const owed = owedRefusals(Object.keys(VALID_BAG[type]));
    for (const [face, judge] of FACES) {
      const result = judge(flattened(type));
      if (owed.length === 0) {
        // `element:divider`'s row declares no prop: there is nothing to write flat.
        expect(result.success, face).toBe(true);
        continue;
      }
      expect(result.success, face).toBe(false);
      // A bag-requiring arm (objectui#11440) also reports the bag itself missing,
      // at `properties`; that is not a flat refusal, so it is held apart here.
      const missingBag = namedAtNode(result).filter((issue) => issue.path[0] === 'properties');
      expect(missingBag.length, face).toBe(REQUIRES_BAG.has(type) ? 1 : 0);
      const named = namedAtNode(result).filter((issue) => issue.path[0] !== 'properties');
      expect(named.map((issue) => String(issue.path[0])).sort(), face).toEqual(owed);
      for (const issue of named) expect(issue.message, face).toContain(`\`properties.${String(issue.path[0])}\``);
      // Nothing is left to the strict face's unnamed `unrecognized_keys`.
      expect(unrecognized(result), face).toEqual([]);
    }
  });

  it.each(COVERED)('%s — GREEN: the same bag, in `properties`, parses on both faces', (type) => {
    for (const [face, judge] of FACES) {
      const result = judge({ type, properties: VALID_BAG[type] });
      expect(result.success, `${face}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it.each(COVERED.filter((type) => owedRefusals(Object.keys(VALID_BAG[type])).length > 0))(
    '%s — the spec\'s own page component refuses the same flat keys, so this face and `os validate` agree',
    (type) => {
      const spec = PageComponentSchema.safeParse(flattened(type)) as unknown as Result;
      expect(spec.success).toBe(false);
      expect(unrecognized(spec).sort()).toEqual(owedRefusals(Object.keys(VALID_BAG[type])));
    },
  );
});

describe('objectui#10872 batch 10 — what the refusal leaves alone', () => {
  const NODE_LEVEL_ROW_KEYS = COVERED.flatMap((type) =>
    Object.keys(rowOf(ARMS.get(type)!).shape)
      .filter((key) => SPEC_NODE_KEYS.has(key) && key !== 'type')
      .map((key) => [`${type}.${key}`, type, key] as const),
  );

  it('some rows do declare a node-level key (non-vacuity)', () => {
    expect(NODE_LEVEL_ROW_KEYS.map(([label]) => label)).toContain('action:button.label');
  });

  it.each(NODE_LEVEL_ROW_KEYS)('%s — a key the spec\'s page component declares on the node is not pointed at the bag', (_label, type, key) => {
    for (const [face, judge] of FACES) {
      const result = judge({ type, [key]: key === 'aria' ? { ariaLabel: 'x' } : 'Label' });
      const toBag = issuesOf(result).filter((issue) => issue.message.includes(`properties.${key}`));
      expect(toBag, face).toEqual([]);
    }
  });

  it('`label` written on an `action:button` node still parses on both faces (the spec declares it there)', () => {
    for (const [face, judge] of FACES) {
      expect(judge({ type: 'action:button', label: 'Open', properties: { actionType: 'url', target: '/x' } }).success, face).toBe(true);
    }
  });

  const RETIRED = COVERED.flatMap((type) => {
    const row = rowOf(ARMS.get(type)!);
    return Object.keys(row.shape)
      .filter((key) => !SPEC_NODE_KEYS.has(key) && isNeverMember(row.shape[key]))
      .map((key) => [`${type}.${key}`, type, key] as const);
  });

  it('some row members are the spec\'s own retirements (non-vacuity)', () => {
    expect(RETIRED.map(([label]) => label)).toContain('page:header.icon');
  });

  it.each(RETIRED.filter(([label]) => label !== 'page:card.body'))(
    '%s — a retired row member written flat keeps the row\'s own retirement, by reference',
    (_label, type, key) => {
      const arm = ARMS.get(type)!;
      expect(arm.shape[key]).toBe(rowOf(arm).shape[key]);
      expect(messageOf(arm.shape[key])).not.toContain(`properties.${key}`);
    },
  );

  it.each(Object.entries(OWN_FLAT_REFUSALS).flatMap(([type, keys]) => keys.map((key) => [`${type}.${key}`, type, key] as const)))(
    '%s — a bag member the arm refuses flat with its own refusal keeps it, and is not pointed at the bag',
    (_label, type, key) => {
      const arm = ARMS.get(type)!;
      // A member of the bag, so the generated refusal would have applied without the arm's own.
      expect(Object.keys(rowOf(arm).shape)).toContain(key);
      expect(messageOf(arm.shape[key])).toContain('RUNTIME SLOT');
      expect(messageOf(arm.shape[key])).not.toContain(`properties.${key}`);
      for (const [face, judge] of FACES) {
        const issue = issuesOf(judge({ type, [key]: { action: 'toast' } })).find((i) => i.path.join('.') === key);
        expect(issue?.code, face).toBe('custom');
        expect(issue?.message, face).toContain('RUNTIME SLOT');
      }
    },
  );

  it('an arm\'s own refusal of a row key outranks the generated one', () => {
    // `record:alert`'s `body` (objectui#10872 batch 3) says why `children` is no remedy here.
    expect(messageOf(ARMS.get('record:alert')!.shape.body)).toContain('objectui#9256');
    // The `action:` controls' `onSuccess` (batch 4) names the post-success block.
    expect(messageOf(ARMS.get('action:button')!.shape.onSuccess)).toContain('{ navigate, openIn }');
    // A `page:` container's child list (batch 6) keeps its own guidance, and the
    // row's retired `body` on `page:card` keeps pointing at `properties.children`.
    expect(messageOf(ARMS.get('page:section')!.shape.children)).toContain('`properties.children`');
    expect(messageOf(ARMS.get('page:card')!.shape.body)).toContain('`properties.children`');
  });

  it.each([...EARLIER])('%s — the earlier batches\' arms refuse every owed flat key as well (the shared invariant)', (type) => {
    const arm = ARMS.get(type)!;
    for (const key of owedRefusals(Object.keys(rowOf(arm).shape))) {
      expect(isNeverMember(arm.shape[key]), `${type}.${key}`).toBe(true);
    }
  });
});

describe('objectui#10872 batch 10 — nested nodes are judged the same way', () => {
  it.each(FACES)('%s face: a flat key on a child in a node-level slot is refused at its own path', (face, judge) => {
    const result = judge({ type: 'page', children: [{ type: 'record:details', columns: '2' }] });
    expect(result.success, face).toBe(false);
    const issue = issuesOf(result).find((i) => i.path.join('.') === 'children.0.columns');
    expect(issue?.message, face).toContain('`properties.columns`');
  });

  it.each(FACES)('%s face: a flat key on a child in a bag child list is refused at its own path', (face, judge) => {
    const result = judge({ type: 'page:section', properties: { children: [{ type: 'element:text', content: 'Hi' }] } });
    expect(result.success, face).toBe(false);
    const issue = issuesOf(result).find((i) => i.path.join('.') === 'properties.children.0.content');
    expect(issue?.message, face).toContain('`properties.content`');
  });
});

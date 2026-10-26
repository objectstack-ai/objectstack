/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The six public blocks held back from batch 1 validate by their spec
 * `ComponentPropsMap` rows (objectui#10872, batch 4).
 *
 * ## The defect these pin
 *
 * `action:button`, `action:group`, `action:menu`, `action:icon`,
 * `element:definition-list` and `element:repeater` are registered and curated
 * by ADR-0080, and `AnyComponentSchema` carried no arm for any of them — so
 * `safeValidateSchema` and `objectui validate` refused every document naming
 * one with `invalid_union` at `type`. That included the node the validator's
 * own handler-key remedy teaches (`action:button`). They were held because
 * `@objectstack/spec` had no row for them; 17.5.0 carries one for each,
 * measured at the renderers' read points (objectstack-ai/objectstack#20371).
 *
 * ## What is read, and against what
 *
 * Every reading below is taken against the INSTALLED spec's row, so a row the
 * spec moves moves these readings with it. The "read point" block pins where
 * the rows disagree with the blocks' registrations — each a key a registration
 * publishes that no renderer reads — at the validator: the arm follows the
 * row, so it refuses what the row refuses. The registrations themselves are
 * not this file's (see `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ComponentPropsMap, PageComponentSchema } from '@objectstack/spec/ui';

import {
  ActionButtonBlockSchema,
  ActionGroupBlockSchema,
  ActionIconBlockSchema,
  ActionMenuBlockSchema,
  ElementDefinitionListBlockSchema,
  ElementRepeaterBlockSchema,
  PublicBlockComponentSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';
import { stripImportedDefaults } from '../zod/imported-defaults.js';

type Issue = { code: string; path: PropertyKey[]; message: string; keys?: string[]; errors?: Issue[][] };
type Result = { success: boolean; error?: { issues: z.core.$ZodIssue[] } };

const FACES: ReadonlyArray<readonly [string, (document: unknown) => Result]> = [
  ['tolerant', (document) => safeValidateSchema(document)],
  ['strict', (document) => StrictAnyComponentSchema.safeParse(document)],
];

/** The six batch-4 blocks and the arm each one exports. */
const ARMS: ReadonlyArray<readonly [type: string, arm: z.ZodObject]> = [
  ['action:button', ActionButtonBlockSchema as unknown as z.ZodObject],
  ['action:icon', ActionIconBlockSchema as unknown as z.ZodObject],
  ['action:group', ActionGroupBlockSchema as unknown as z.ZodObject],
  ['action:menu', ActionMenuBlockSchema as unknown as z.ZodObject],
  ['element:definition-list', ElementDefinitionListBlockSchema as unknown as z.ZodObject],
  ['element:repeater', ElementRepeaterBlockSchema as unknown as z.ZodObject],
];
const TYPES = ARMS.map(([type]) => type);

const rowOf = (type: string): z.ZodType => (ComponentPropsMap as unknown as Record<string, z.ZodType>)[type];
const bagOf = (arm: z.ZodObject): z.ZodType => (arm.shape.properties as z.ZodOptional).unwrap() as z.ZodType;
const keysOf = (schema: z.ZodType): string[] =>
  Object.keys((schema as unknown as { shape?: Record<string, unknown> }).shape ?? {}).sort();

/** The taught node with its bag hoisted flat — the spelling the page taught before objectui#11183. */
const flattened = (node: Record<string, unknown>): Record<string, unknown> => {
  const { properties, ...rest } = node;
  return { ...rest, ...(properties as Record<string, unknown>) };
};

/** Every issue, union branches unfolded and paths made absolute. */
const allIssues = (issues: Issue[] | undefined, prefix: PropertyKey[] = []): Issue[] =>
  (issues ?? []).flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    return [{ ...issue, path }, ...(issue.errors ?? []).flatMap((branch) => allIssues(branch, path))];
  });
const issuesOf = (result: Result): Issue[] => allIssues(result.error?.issues as unknown as Issue[] | undefined);
const at = (result: Result, path: string): Issue[] => issuesOf(result).filter((i) => i.path.join('.') === path);
const refusedKeys = (result: Result): string[] =>
  issuesOf(result).flatMap((i) => (i.code === 'unrecognized_keys' ? i.keys ?? [] : []));

describe('objectui#10872 batch 4 — the six held blocks are armed, by reference', () => {
  it('each arm is a member of `PublicBlockComponentSchema`, under its own literal', () => {
    const options = (PublicBlockComponentSchema as unknown as { options: z.ZodObject[] }).options;
    for (const [type, arm] of ARMS) {
      expect(options, type).toContain(arm);
      expect((arm.shape.type as z.ZodLiteral).value, type).toBe(type);
    }
  });

  it.each(TYPES)('%s: the spec carries a row, and it is in the page vocabulary', (type) => {
    expect(rowOf(type), `${type} has no ComponentPropsMap row on the installed spec`).toBeDefined();
    expect(PageComponentSchema.safeParse({ type }).success).toBe(true);
  });

  // `element:repeater`'s bag was its row with `object` alone made optional from
  // objectui#12056 until `@objectstack/spec` 18 retired that `object`
  // (objectui#12030); it is the row by reference again, so it is back in this row.
  it.each(ARMS)('%s: the bag IS the spec row — nothing restated, nothing stripped', (type, arm) => {
    const row = rowOf(type);
    // The two element rows carry no default and no `z.lazy`, so the import
    // boundary is the identity function on them (objectui#8317). Since
    // @objectstack/spec 18.0.0-next.1 the four action rows take `onSuccess` as
    // `ActionSchema`'s own block, whose `openIn` carries `.default('self')`, so
    // the boundary rebuilds them without that default (objectui#12370).
    const bounded = stripImportedDefaults(row);
    if (type.startsWith('action:')) expect(bounded).not.toBe(row);
    else expect(bounded).toBe(row);
    // …and the arm holds the spec's own schema through that boundary: its
    // DEFINITION is the bounded row's (memoised, so one instance per row).
    // Not `toBe(bounded)`: 17.5.0 publishes these rows as lazy proxies whose
    // methods run on the real schema, so `.optional()` wraps the object behind
    // the proxy, and the definition is the identity that survives.
    expect((bagOf(arm) as unknown as { _zod: { def: unknown } })._zod.def)
      .toBe((bounded as unknown as { _zod: { def: unknown } })._zod.def);
    expect(keysOf(bagOf(arm))).toEqual(keysOf(row));
  });

  it.each(TYPES)('%s: no longer refused at `type` — the minimal node parses on both faces', (type) => {
    for (const [face, judge] of FACES) {
      const result = judge({ type });
      expect(result.success, `${face}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it('CONTROL — an unarmed namespaced literal is still refused at `type`', () => {
    const result = safeValidateSchema({ type: 'action:no-such-control-10872' });
    expect(result.success).toBe(false);
    expect(at(result, 'type').map((i) => i.code)).toContain('invalid_union');
  });
});

describe('objectui#10872 batch 4 — the arm follows the row, which follows the read points', () => {
  it.each(FACES)('%s face: `action:group` refuses a group-level `name`, which no renderer reads', (_face, judge) => {
    const result = judge({ type: 'action:group', properties: { name: 'row_actions', actions: [] } });
    expect(result.success).toBe(false);
    expect(refusedKeys(result)).toContain('name');
    // Control: the same bag without it parses.
    expect(judge({ type: 'action:group', properties: { actions: [] } }).success).toBe(true);
  });

  it.each(FACES)('%s face: `action:group` refuses `size: "md"`, which inline mode hands the primitive raw', (_face, judge) => {
    const result = judge({ type: 'action:group', properties: { size: 'md' } });
    expect(result.success).toBe(false);
    expect(at(result, 'properties.size').length).toBeGreaterThan(0);
    expect(judge({ type: 'action:group', properties: { size: 'sm' } }).success).toBe(true);
    // `action:menu` hands its `size` to the primitive unmapped on every path.
    expect(at(judge({ type: 'action:menu', properties: { size: 'md' } }), 'properties.size').length).toBeGreaterThan(0);
    expect(judge({ type: 'action:menu', properties: { size: 'icon' } }).success).toBe(true);
  });

  it.each(FACES)('%s face: `element:definition-list` takes the NUMBER `columns` the renderer compares', (_face, judge) => {
    const result = judge({ type: 'element:definition-list', properties: { columns: '2' } });
    expect(result.success).toBe(false);
    expect(at(result, 'properties.columns').length).toBeGreaterThan(0);
    expect(judge({ type: 'element:definition-list', properties: { columns: 2 } }).success).toBe(true);
  });

  it.each(FACES)('%s face: `element:definition-list` items are strict `{ term, description }`', (_face, judge) => {
    // The `label` / `value` items the designer wrote until objectui#8279, every row blank.
    const result = judge({ type: 'element:definition-list', properties: { items: [{ label: 'Owner', value: 'Ada' }] } });
    expect(result.success).toBe(false);
    expect(refusedKeys(result)).toEqual(expect.arrayContaining(['label', 'value']));
  });

  it.each(FACES)('%s face: `element:repeater` refuses a `fields[].label`, which the list never prints', (_face, judge) => {
    const result = judge({ type: 'element:repeater', dataSource: { object: 'task' }, properties: { fields: [{ field: 'subject', label: 'Subject' }] } });
    expect(result.success).toBe(false);
    expect(refusedKeys(result)).toContain('label');
    expect(judge({ type: 'element:repeater', dataSource: { object: 'task' }, properties: { fields: [{ field: 'subject' }, 'status'] } }).success)
      .toBe(true);
  });

  it.each(FACES)('%s face: `element:repeater` refuses a flat `object` — the binding names it (objectui#12030)', (_face, judge) => {
    // objectui#12056 mirrored the spec gate's waiver of a required flat `object`
    // beside a binding; `@objectstack/spec` 18 retired the flat `object`, so the
    // bag refuses it by name and the binding is where the object is written.
    const result = judge({ type: 'element:repeater', properties: { object: 'task' } });
    expect(result.success).toBe(false);
    expect(at(result, 'properties.object').length).toBeGreaterThan(0);
    expect(judge({ type: 'element:repeater', properties: {}, dataSource: { object: 'task' } }).success).toBe(true);
  });

  it.each(FACES)('%s face: `objectName` is the two single actions\' key, and each MEMBER\'s on the containers', (_face, judge) => {
    expect(judge({ type: 'action:button', properties: { label: 'Log call', objectName: 'task' } }).success).toBe(true);
    expect(judge({ type: 'action:icon', properties: { icon: 'phone', objectName: 'task' } }).success).toBe(true);
    // The containers forward it per member, so it rides the member object…
    expect(judge({ type: 'action:group', properties: { actions: [{ name: 'log', objectName: 'task' }] } }).success).toBe(true);
    expect(judge({ type: 'action:menu', properties: { actions: [{ name: 'log', objectName: 'task' }] } }).success).toBe(true);
    // …and the container rows refuse it at container level.
    expect(refusedKeys(judge({ type: 'action:group', properties: { objectName: 'task' } }))).toContain('objectName');
    expect(refusedKeys(judge({ type: 'action:menu', properties: { objectName: 'task' } }))).toContain('objectName');
  });
});

describe('objectui#10872 batch 4 — the two handler keys the action renderers read off the node', () => {
  it.each([['action:button'], ['action:icon']])('%s refuses an authored `onClick` by name — a runtime slot (objectui#6124)', (type) => {
    for (const [face, judge] of FACES) {
      const result = judge({ type, onClick: { action: 'toast' } });
      expect(result.success, face).toBe(false);
      const issue = at(result, 'onClick')[0];
      expect(issue?.code, face).toBe('custom');
      expect(issue?.message, face).toContain('RUNTIME SLOT');
      // Control: the node without it parses.
      expect(judge({ type }).success, face).toBe(true);
    }
    // The row does not take it in the bag either.
    expect(refusedKeys(safeValidateSchema({ type, properties: { onClick: { action: 'toast' } } }))).toContain('onClick');
  });

  it.each([['action:button'], ['action:icon']])('%s refuses a flat `onSuccess`, naming `properties.onSuccess`', (type) => {
    for (const [face, judge] of FACES) {
      const result = judge({ type, onSuccess: { navigate: '/tasks' } });
      expect(result.success, face).toBe(false);
      const issue = at(result, 'onSuccess')[0];
      expect(issue?.code, face).toBe('invalid_type');
      expect(issue?.message, face).toContain('Did you mean `onSuccess` → `properties.onSuccess`?');
      // What the remedy sends the author to is accepted: `properties.onSuccess` on a row
      // whose executor carries the hop. Since @objectstack/spec 18.0.0-next.1 a row with
      // no executor refuses `onSuccess` (objectui#12338), so the row names `api`.
      expect(
        judge({ type, properties: { actionType: 'api', target: '/api/tasks/archive', onSuccess: { navigate: '/tasks' } } }).success,
        face,
      ).toBe(true);
    }
    // The spec's own page component refuses the flat spelling as well.
    expect(PageComponentSchema.safeParse({ type, onSuccess: { navigate: '/tasks' } }).success).toBe(false);
  });
});

/* ── The taught `action:button` node ──────────────────────────────────────── */

/** Rooted on this file, never on `process.cwd()`. */
const HERE = dirname(fileURLToPath(import.meta.url));
const QUICK_START = join(HERE, '..', '..', '..', '..', 'content', 'docs', 'guide', 'quick-start.md');

/**
 * The quick-start's "Add Actions" node — the one AGENTS.md #4 teaches, read from
 * the page that teaches it. Since objectui#11183 the page writes it in the spec's
 * spelling: the block's props in `properties`, nothing flat on the node.
 */
function taughtActionButton(): Record<string, unknown> {
  const doc = readFileSync(QUICK_START, 'utf8');
  const section = doc.slice(doc.indexOf('### Add Actions'));
  const fence = /```json\n([\s\S]*?)\n```/.exec(section);
  if (!fence) throw new Error('no ```json fence under "### Add Actions" in the quick-start');
  return JSON.parse(fence[1]) as Record<string, unknown>;
}

describe('objectui#10872 batch 4 — a page with an `action:button` validates', () => {
  it('reads the taught node (non-vacuity) — and it is in the bag spelling', () => {
    const node = taughtActionButton();
    expect(node.type).toBe('action:button');
    const bag = node.properties as Record<string, unknown>;
    expect(bag.actionType).toBe('url');
    expect(bag.target).toBe('/users/ada');
    // Nothing executor-shaped is left flat on the node (objectui#11183).
    expect(node).not.toHaveProperty('actionType');
    expect(node).not.toHaveProperty('target');
  });

  it('the taught node, in a page, passes the tolerant face', () => {
    const page = { type: 'page', title: 'Users', children: [{ type: 'page:header', properties: { title: 'Users' } }, taughtActionButton()] };
    const result = safeValidateSchema(page);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it.each(FACES)('%s face: the taught node AS WRITTEN — its props in `properties` — validates, in a page and alone', (_face, judge) => {
    const page = { type: 'page', children: [{ type: 'page:header', properties: { title: 'Users' } }, taughtActionButton()] };
    const result = judge(page);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    expect(judge(taughtActionButton()).success).toBe(true);
  });

  it('the spec\'s own `PageComponentSchema` accepts the taught node as written', () => {
    expect(PageComponentSchema.safeParse(taughtActionButton()).success).toBe(true);
  });

  it.each(FACES)('CONTROL (%s face) — the pre-objectui#11183 FLAT spelling of the same node is refused by name, at exactly its two executor keys', (face, judge) => {
    // objectui#10872's fork, ruled A on objectui#11183: the `properties` bag is
    // the contract. Since objectui#10872 batch 10 a row member written flat on
    // the node is refused BY NAME on both faces, at its own path, with a message
    // naming its bag member (`flatPropRefusals`). `label` stays: the spec's page
    // component declares a node-level `label` of its own. So both faces refuse
    // exactly `actionType` and `target`, as the spec's `PageComponentSchema`
    // does. Derived from the taught node rather than transcribed, so the control
    // moves with the page.
    const flat = flattened(taughtActionButton());
    expect(flat.actionType).toBe('url');
    const result = judge(flat);
    expect(result.success, face).toBe(false);
    const named = issuesOf(result).filter((i) => i.code === 'invalid_type' && i.path.length === 1);
    expect(named.map((i) => String(i.path[0])).sort(), face).toEqual(['actionType', 'target']);
    for (const issue of named) expect(issue.message, face).toContain(`\`properties.${String(issue.path[0])}\``);
    // Nothing is left to the strict face's unnamed `unrecognized_keys`.
    expect(refusedKeys(result), face).toEqual([]);
  });

  it('CONTROL — the spec\'s own `PageComponentSchema` refuses the same two flat keys', () => {
    const spec = PageComponentSchema.safeParse(flattened(taughtActionButton()));
    expect(spec.success).toBe(false);
    expect(refusedKeys(spec as Result).sort()).toEqual(['actionType', 'target']);
  });
});

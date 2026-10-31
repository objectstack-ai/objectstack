// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28020] A view filter list can hold an any-of group: `{ any: [rule, ...] }`.
 *
 * The list stays an AND list of flat `ViewFilterRule`s; one new element kind
 * sits beside the rule and holds a non-empty list of flat rules of which ANY
 * may match. These pins hold the four halves of that contract:
 *
 * 1. a group is ACCEPTED on every carrier of the filter list;
 * 2. every filter stored before the group parses exactly as it did — same
 *    output for an accepted rule, same issues (code, path, message) for a
 *    refused one, because the element union reports only the claimed branch;
 * 3. the rule's own refinements apply INSIDE a group exactly as at top level;
 * 4. an empty group, a nested group and a non-rule member are REFUSED, each
 *    with its own code at its own path.
 *
 * Every rejection pin asserts the issue code and path, and the message's
 * leading words where the wording is the contract (a prescription an author
 * acts on), never a bare throw.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ListViewSchema,
  ViewFilterAnyGroupSchema,
  ViewFilterElementSchema,
  ViewFilterRuleSchema,
  ViewMetadataSchema,
  ViewTabSchema,
  isViewFilterAnyGroup,
} from './view.zod';
import { ElementDataSourceSchema, InterfacePageConfigSchema } from './page.zod';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC_SRC = resolve(HERE, '..');

type Issue = { code: string; path: PropertyKey[]; message: string };

function issuesOf(result: { success: boolean; error?: { issues: unknown[] } }): Issue[] {
  expect(result.success).toBe(false);
  return (result.error!.issues as Issue[]).map(({ code, path, message }) => ({ code, path, message }));
}

const listView = (filter: unknown) => ({ type: 'grid', columns: ['name'], filter });

/** "open, or completed in the last 7 days" — the view the card names. */
const OPEN_OR_RECENT = {
  any: [
    { field: 'status', operator: 'equals', value: 'open' },
    { field: 'completed_at', operator: 'after', value: '{7_days_ago}' },
  ],
};

describe('a group is accepted on every carrier of the filter list', () => {
  const carriers: Array<[string, (filter: unknown) => { success: boolean; data?: unknown }]> = [
    ['ListView.filter', (f) => ListViewSchema.safeParse(listView(f))],
    ['ViewTab.filter', (f) => ViewTabSchema.safeParse({ name: 'recent', filter: f })],
    ['ElementDataSource.filter', (f) => ElementDataSourceSchema.safeParse({ object: 'task', filter: f })],
    ['InterfacePageConfig.filterBy', (f) => InterfacePageConfigSchema.safeParse({ source: 'task', filterBy: f })],
  ];

  it.each(carriers)('%s takes a group beside a plain rule', (_name, parse) => {
    const filter = [OPEN_OR_RECENT, { field: 'owner', operator: 'equals', value: '{current_user_id}' }];
    const result = parse(filter);
    expect(result.success).toBe(true);
  });

  it('the group parses to itself — nothing added, dropped or reordered', () => {
    const parsed = ListViewSchema.parse(listView([OPEN_OR_RECENT]));
    expect(parsed.filter).toEqual([OPEN_OR_RECENT]);
  });

  it('every filter-list carrier in the spec holds the ELEMENT, not the bare rule', () => {
    // A source scan: a carrier added later with the bare rule array would take
    // no group. Two bare-rule arrays are expected and named: the group's own
    // members (one level only) and the solution-blueprint view filters, which
    // deliberately stay flat (their docblock says why).
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (entry.endsWith('.zod.ts')) files.push(path);
      }
    };
    walk(SPEC_SRC);
    const bare: string[] = [];
    for (const file of files) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith('*') || code.startsWith('//')) return;
        if (code.includes('z.array(ViewFilterRuleSchema')) bare.push(`${file.slice(SPEC_SRC.length + 1)}:${code.split(':')[0]}`);
      });
    }
    expect(bare.sort()).toEqual(['ai/solution-blueprint.zod.ts:filters', 'ui/view.zod.ts:any']);
  });
});

describe('a filter stored before the group parses exactly as it did', () => {
  // Accepted rules, alias spellings among them: the element parses each to
  // what the rule alone parses it to.
  const accepted: unknown[] = [
    { field: 'status', operator: 'equals', value: 'active' },
    { field: 'stage', operator: 'notIn', value: ['won', 'lost'] },
    { field: 'amount', operator: 'gte', value: 100 },
    { field: 'close_date', operator: 'between', value: ['2024-01-01', '2024-12-31'] },
    { field: 'archived_at', operator: 'isNull' },
    { field: 'name', operator: 'icontains', value: 'acme' },
  ];

  it.each(accepted)('accepts %j with the rule\'s own output', (rule) => {
    expect(ViewFilterElementSchema.parse(rule)).toEqual(ViewFilterRuleSchema.parse(rule));
  });

  // Refused rules: the element reports the RULE's issues, flat — never an
  // `invalid_union` with the group branch's complaint beside them.
  const refused: unknown[] = [
    { field: 'stage', operator: 'in', value: 'won' },
    { field: 'name', operator: 'icontains', value: '' },
    { field: 'status', operator: 'equals' },
    { field: 'status', operator: 'nope', value: 'x' },
    { field: 'status', operator: 'equals', value: 'x', id: 'row-1' },
    { operator: 'equals', value: 'x' },
  ];

  it.each(refused)('refuses %j with the rule\'s own issues', (rule) => {
    const asElement = issuesOf(ViewFilterElementSchema.safeParse(rule));
    const asRule = issuesOf(ViewFilterRuleSchema.safeParse(rule));
    expect(asElement).toEqual(asRule);
    expect(asElement.some((issue) => issue.code === 'invalid_union')).toBe(false);
  });

  it('a refused rule is located at its own path through a carrier', () => {
    const issues = issuesOf(ListViewSchema.safeParse(listView([{ field: 'stage', operator: 'in', value: 'won' }])));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('custom');
    expect(issues[0]!.path).toEqual(['filter', 0, 'value']);
    expect(issues[0]!.message.startsWith('Operator "in" on field "stage" requires an ARRAY of values.')).toBe(true);
  });
});

describe('the rule\'s refinements apply inside a group exactly as at top level', () => {
  it('the value shape is coupled to the operator', () => {
    const issues = issuesOf(ListViewSchema.safeParse(listView([{ any: [{ field: 'stage', operator: 'in', value: 'won' }] }])));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('custom');
    expect(issues[0]!.path).toEqual(['filter', 0, 'any', 0, 'value']);
    expect(issues[0]!.message.startsWith('Operator "in" on field "stage" requires an ARRAY of values.')).toBe(true);
  });

  it('the `icontains` comparand is judged', () => {
    const issues = issuesOf(ListViewSchema.safeParse(listView([{ any: [{ field: 'name', operator: 'icontains', value: '' }] }])));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('custom');
    expect(issues[0]!.path).toEqual(['filter', 0, 'any', 0, 'value']);
  });

  it('legacy operator spellings fold to canonical inside a group too', () => {
    const parsed = ListViewSchema.parse(listView([{ any: [{ field: 'amount', operator: 'gt', value: 1 }] }]));
    expect(parsed.filter).toEqual([{ any: [{ field: 'amount', operator: 'greater_than', value: 1 }] }]);
  });
});

describe('what a group refuses', () => {
  it('an EMPTY group — it would match no record', () => {
    const issues = issuesOf(ListViewSchema.safeParse(listView([{ any: [] }])));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('too_small');
    expect(issues[0]!.path).toEqual(['filter', 0, 'any']);
    expect(issues[0]!.message.startsWith('An any-of group needs at least one rule')).toBe(true);
  });

  it('a NESTED group — one level only, refused by name', () => {
    const nested = { any: [{ any: [{ field: 'status', operator: 'equals', value: 'open' }] }] };
    const issues = issuesOf(ListViewSchema.safeParse(listView([nested])));
    const unknown = issues.find((issue) => issue.code === 'unrecognized_keys');
    expect(unknown?.path).toEqual(['filter', 0, 'any', 0]);
    expect(unknown?.message).toContain('an any-of group cannot hold another group');
  });

  it('a member that is not a rule', () => {
    const issues = issuesOf(ListViewSchema.safeParse(listView([{ any: ['status = open'] }])));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('invalid_type');
    expect(issues[0]!.path).toEqual(['filter', 0, 'any', 0]);
  });

  it('a non-array `any`', () => {
    const issues = issuesOf(ListViewSchema.safeParse(listView([{ any: { field: 'status' } }])));
    expect(issues[0]!.code).toBe('invalid_type');
    expect(issues[0]!.path).toEqual(['filter', 0, 'any']);
  });

  it('a rule key written beside `any` — it belongs to a rule', () => {
    const issues = issuesOf(ListViewSchema.safeParse(listView([{ ...OPEN_OR_RECENT, field: 'owner' }])));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('unrecognized_keys');
    expect(issues[0]!.path).toEqual(['filter', 0]);
    expect(issues[0]!.message).toContain('an any-of group holds only `any`');
  });

  it.each(['$or', 'or', 'logic', 'conditions'])('the OR spelling `%s` on a rule is answered with the group', (key) => {
    const issues = issuesOf(ListViewSchema.safeParse(listView([{ [key]: [{ field: 'status', operator: 'equals', value: 'open' }] }])));
    const unknown = issues.find((issue) => issue.code === 'unrecognized_keys');
    expect(unknown?.path).toEqual(['filter', 0]);
    expect(unknown?.message).toContain('`{ any: [rule, ...] }`');
  });
});

describe('the wire door and the published shape', () => {
  it('the console row `id` is stripped inside a group as on a plain rule', () => {
    const body = {
      name: 'task.recent', object: 'task', viewKind: 'list', label: 'Recent', type: 'grid', columns: ['name'],
      filter: [{ id: 'root', any: [{ id: 'r1', field: 'status', operator: 'equals', value: 'open' }] }],
    };
    const parsed = ViewMetadataSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect((parsed.data as { filter: unknown }).filter).toEqual([
      { any: [{ field: 'status', operator: 'equals', value: 'open' }] },
    ]);
  });

  it('…while the AUTHORING door still refuses an authored `id` on a group, by name', () => {
    const issues = issuesOf(ListViewSchema.safeParse(listView([{ id: 'root', ...OPEN_OR_RECENT }])));
    expect(issues[0]!.code).toBe('unrecognized_keys');
    expect(issues[0]!.message).toContain('`id` is a console row key');
  });

  it('the element publishes both kinds, and the group says it is not yet rendered', () => {
    const json = z.toJSONSchema(ViewFilterElementSchema, { io: 'input', unrepresentable: 'any' }) as {
      anyOf?: Array<{ properties?: Record<string, unknown> }>;
    };
    expect(json.anyOf?.map((branch) => Object.keys(branch.properties ?? {}).sort())).toEqual([
      ['field', 'operator', 'value'],
      ['any'],
    ]);
    expect(ViewFilterAnyGroupSchema.description?.startsWith('[PLANNED — not yet rendered]')).toBe(true);
  });

  it('`isViewFilterAnyGroup` tells the element kinds apart by the own `any` key', () => {
    expect(isViewFilterAnyGroup(OPEN_OR_RECENT)).toBe(true);
    expect(isViewFilterAnyGroup({ any: 'not yet valid' })).toBe(true);
    expect(isViewFilterAnyGroup({ field: 'status', operator: 'equals', value: 'open' })).toBe(false);
    expect(isViewFilterAnyGroup(Object.create({ any: [] }))).toBe(false);
    expect(isViewFilterAnyGroup([OPEN_OR_RECENT])).toBe(false);
    expect(isViewFilterAnyGroup(null)).toBe(false);
  });
});

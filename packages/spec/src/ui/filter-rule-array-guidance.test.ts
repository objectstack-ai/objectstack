// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The seven converged rule-array `filter` doors name the new spelling when
 * they refuse the old one.
 *
 * Seven doors converged on `z.array(ViewFilterRuleSchema)` (the objectui#6206
 * family) and each one refused the record form an author used to write with a
 * bare `invalid_type` — "Invalid input: expected array, received object", and
 * nothing else. The prescription existed in two places that a parse never
 * reaches (the `.describe()` strings, the three `18.*-filter-rule-array`
 * semantic entries), so the population whose metadata the convergence broke
 * got the one sentence that does not say what to write instead.
 *
 * This file pins four things, and the last two are the ones that keep the
 * message from becoming a seventh transcription of the truth:
 *
 *  §1  every door answers the record form with the prescription;
 *  §2  nothing else is swallowed — an array author's element-level issues and
 *      a non-record value still get the ordinary message;
 *  §3  the `migration` id each door names is a real entry in the migration
 *      registry;
 *  §4  the `surface` each door names is the surface its own `strictObject`
 *      declaration registered, and the rule form in the message is
 *      `ViewFilterRuleSchema`'s own shape.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { ComponentPropsMap } from './component.zod';
import { ElementDataSourceSchema } from './page.zod';
import { ViewFilterRuleSchema, normalizeFilterOperator } from './view.zod';
import { ruleArrayFilterError } from './filter-rule-array';
import { strictObjectDeclarations } from '../shared/strict-object';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';

/** The record form these doors took before the convergence. */
const RECORD_FORM = { status: 'active' } as const;

/**
 * The seven doors, each with enough sibling props to reach a clean reading —
 * the other required keys are filled so the only issue under test is `filter`.
 */
const DOORS: readonly {
  readonly name: string;
  readonly surface: string;
  readonly migration: string;
  readonly parse: (filter: unknown) => z.ZodSafeParseResult<unknown>;
}[] = [
  {
    name: 'ElementDataSourceSchema.filter',
    surface: 'this element data source',
    migration: 'element-data-source-and-object-block-filter-rule-array',
    parse: (filter) => ElementDataSourceSchema.safeParse({ object: 'task', filter }),
  },
  {
    name: "ComponentPropsMap['object-grid'].filter",
    surface: 'this `object-grid`',
    migration: 'element-data-source-and-object-block-filter-rule-array',
    parse: (filter) => ComponentPropsMap['object-grid'].safeParse({ objectName: 'task', filter }),
  },
  {
    name: "ComponentPropsMap['object-metric'].filter",
    surface: 'this `object-metric`',
    migration: 'element-data-source-and-object-block-filter-rule-array',
    parse: (filter) => ComponentPropsMap['object-metric'].safeParse({ objectName: 'task', filter }),
  },
  {
    name: "ComponentPropsMap['object-kanban'].filter",
    surface: 'this `object-kanban`',
    migration: 'element-data-source-and-object-block-filter-rule-array',
    parse: (filter) => ComponentPropsMap['object-kanban'].safeParse({ objectName: 'task', filter }),
  },
  {
    name: "ComponentPropsMap['object-calendar'].filter",
    surface: 'this `object-calendar`',
    migration: 'element-data-source-and-object-block-filter-rule-array',
    parse: (filter) => ComponentPropsMap['object-calendar'].safeParse({ objectName: 'task', filter }),
  },
  {
    name: "ComponentPropsMap['element:number'].filter",
    surface: 'this `element:number`',
    migration: 'element-number-filter-rule-array',
    parse: (filter) =>
      ComponentPropsMap['element:number'].safeParse({ object: 'task', aggregate: 'count', filter }),
  },
  {
    name: "ComponentPropsMap['element:record_picker'].filter",
    surface: 'this `element:record_picker`',
    migration: 'element-record-picker-filter-rule-array',
    parse: (filter) => ComponentPropsMap['element:record_picker'].safeParse({ object: 'task', filter }),
  },
];

/** The one issue raised at the `filter` key itself. */
function filterIssue(result: z.ZodSafeParseResult<unknown>) {
  expect(result.success).toBe(false);
  if (result.success) throw new Error('unreachable');
  const at = result.error.issues.filter((i) => i.path.join('.') === 'filter');
  expect(at).toHaveLength(1);
  return at[0]!;
}

describe('§1 the record form is refused WITH the new spelling', () => {
  it.each(DOORS.map((d) => [d.name, d] as const))('%s', (_name, door) => {
    const issue = filterIssue(door.parse(RECORD_FORM));

    // Still the same refusal — this round moves what it SAYS, not what is accepted.
    expect(issue.code).toBe('invalid_type');

    // Names the new spelling: the rule-array form, and the author's own key
    // carried into a worked rewrite.
    expect(issue.message).toContain('[{ field, operator, value }, ...]');
    expect(issue.message).toContain("[{ field: 'status', operator: 'equals', value: 'active' }]");

    // Names where the full conversion table lives, and which door this is.
    expect(issue.message).toContain(`migration \`${door.migration}\``);
    expect(issue.message).toContain(door.surface);
  });

  it('the rewrite is computed from the author own record, not a canned example', () => {
    const issue = filterIssue(
      ElementDataSourceSchema.safeParse({
        object: 'task',
        filter: { owner: 'me', priority: 3, archived: false },
      }),
    );
    expect(issue.message).toContain(
      "[{ field: 'owner', operator: 'equals', value: 'me' }, "
      + "{ field: 'priority', operator: 'equals', value: 3 }, "
      + "{ field: 'archived', operator: 'equals', value: false }]",
    );
  });

  it('an operator-object value is not mis-prescribed as an `equals` scalar', () => {
    const issue = filterIssue(
      ElementDataSourceSchema.safeParse({ object: 'task', filter: { amount: { $gt: 100 } } }),
    );
    expect(issue.message).toContain("{ field: 'amount', operator: …, value: … }");
    expect(issue.message).toContain('lifts that operator into `operator`');
    expect(issue.message).not.toContain("operator: 'equals', value: { ");
  });
});

describe('§2 nothing else is swallowed', () => {
  // The door-shaped negative control: the array author whose element is wrong.
  // The card's own warning — a blanket message here would overwrite exactly
  // these issues, which are the ones an array author needs.
  it.each(DOORS.map((d) => [d.name, d] as const))(
    '%s — a bad ELEMENT still reports at `filter.0` in zod own words',
    (_name, door) => {
      const result = door.parse([{ field: 'status', operator: 'nope', value: 'active' }]);
      expect(result.success).toBe(false);
      if (result.success) throw new Error('unreachable');
      const under = result.error.issues.filter((i) => i.path.join('.').startsWith('filter.'));
      expect(under.length).toBeGreaterThan(0);
      for (const issue of under) {
        expect(issue.message).not.toContain('migration `');
        expect(issue.message).not.toContain('[{ field, operator, value }, ...]');
      }
      // …and the array door itself says nothing at all here.
      expect(result.error.issues.filter((i) => i.path.join('.') === 'filter')).toHaveLength(0);
    },
  );

  it('a non-record value falls through to zod own message', () => {
    const issue = filterIssue(ElementDataSourceSchema.safeParse({ object: 'task', filter: 'status=active' }));
    expect(issue.message).toBe('Invalid input: expected array, received string');
  });

  it('a class instance is a different mistake and is not sent to the filter migration', () => {
    const issue = filterIssue(ElementDataSourceSchema.safeParse({ object: 'task', filter: new Date() }));
    expect(issue.message).not.toContain('migration `');
  });

  it('the valid rule array still parses', () => {
    const ok = ElementDataSourceSchema.safeParse({
      object: 'task',
      filter: [{ field: 'status', operator: 'equals', value: 'active' }],
    });
    expect(ok.success).toBe(true);
  });
});

describe('§3 every migration id named by a door is a real entry', () => {
  const ids = new Set(
    Object.values(MIGRATIONS_BY_MAJOR).flatMap((step) => step.semantic.map((entry) => entry.id)),
  );

  it('the registry was actually read (lit control)', () => {
    expect(ids.size).toBeGreaterThan(0);
    expect(ids.has('no-such-migration-entry')).toBe(false);
  });

  it.each([...new Set(DOORS.map((d) => d.migration))])('%s', (migration) => {
    expect(ids.has(migration)).toBe(true);
  });
});

describe('§4 the message is derived, not transcribed', () => {
  it('the rule form is `ViewFilterRuleSchema` own shape', () => {
    const shape = (ViewFilterRuleSchema as unknown as { _zod: { def: { shape: object } } })._zod.def.shape;
    const issue = filterIssue(ElementDataSourceSchema.safeParse({ object: 'task', filter: RECORD_FORM }));
    expect(issue.message).toContain(`[{ ${Object.keys(shape).join(', ')} }, ...]`);
  });

  it('the prescribed operator is the canonical fold of the equality shorthand', () => {
    const issue = filterIssue(ElementDataSourceSchema.safeParse({ object: 'task', filter: RECORD_FORM }));
    expect(issue.message).toContain(`operator: '${normalizeFilterOperator('eq')}'`);
  });

  it('every wired door names the surface its own strictObject declaration registered', () => {
    // The doors above are all forced by now, so their enclosing declarations
    // are in the store. A declaration whose `filter` answers the record form
    // with this prescription must answer it with that declaration's OWN
    // surface — which is what a copy-pasted eighth door would fail.
    let checked = 0;
    for (const { options, shape } of strictObjectDeclarations()) {
      const filter = (shape as Record<string, unknown>).filter;
      if (!filter || typeof (filter as z.ZodTypeAny).safeParse !== 'function') continue;
      const result = (filter as z.ZodTypeAny).safeParse(RECORD_FORM);
      if (result.success) continue;
      const message = result.error.issues[0]?.message ?? '';
      if (!message.includes('[{ field, operator, value }, ...]')) continue;
      expect(message).toContain(options.surface);
      checked += 1;
    }
    // Lit control: the walk really reached the wired doors.
    expect(checked).toBe(DOORS.length);
  });

  it('the helper answers only the record form (unit, away from the doors)', () => {
    const bare = z.array(ViewFilterRuleSchema, {
      error: ruleArrayFilterError({ surface: 'this probe', migration: 'probe-entry' }),
    });
    expect(bare.safeParse({ a: 1 }).error?.issues[0]?.message).toContain('migration `probe-entry`');
    expect(bare.safeParse(42).error?.issues[0]?.message).toBe('Invalid input: expected array, received number');
  });
});

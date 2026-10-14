// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The page action rows — `action:button`, `action:icon` and an `action:group` /
 * `action:menu` member — judged by `ActionSchema`'s declarative-update rules,
 * from the one judge both read (`action-declarative-update.ts`). Every row
 * forwards `operation`, `patch`, `params`, `target`, the executor key and
 * `locations` to the console's action runner, which reads `operation` before
 * any executor; so a row the action would refuse is refused here too, at the
 * same key, with the action's text (the executor spelled as the row spells it).
 *
 * - §1 THE FIVE MEMBERS the family's closing card names, on every row: each is
 *   one issue at its key, and the same row made valid parses.
 * - §2 ONE TEXT: a member's refusal is `ActionSchema`'s, derived from the
 *   action's own parse rather than restated here.
 * - §3 THE REST OF THE SET: the refused-key table's other row keys, the keys a
 *   row does not declare (refused as unknown before the judge), the executor
 *   rule's edges, `params` as a source of values, and `patch` as the action's
 *   own record.
 * - §4 OPERATION FIRST: beside the operation, the rows' url-target and
 *   executor-alias judgments stand down, so a row is never told to fix a key
 *   it must drop.
 *
 * `ActionSchema`'s own pins are `action-row-update.test.ts`, unchanged. A
 * page's `properties` bag is outside the stack parse; `os validate`'s props
 * gate parses it against these same rows.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';

import { ActionSchema } from './action.zod';
import { ActionButtonPropsSchema, ActionIconPropsSchema, ComponentPropsMap } from './component.zod';

type Issue = { code: string; path: PropertyKey[]; message: string };
type Parsed = { success: boolean; data?: unknown; error?: { issues: unknown[] } };
const issuesOf = (r: Parsed): Issue[] => (r.success ? [] : (r.error?.issues ?? [])) as Issue[];

type Parser = { safeParse: (value: unknown) => Parsed };
const GROUP = ComponentPropsMap['action:group'] as unknown as Parser;
const MENU = ComponentPropsMap['action:menu'] as unknown as Parser;

interface Row {
  readonly name: string;
  readonly parse: (action: Record<string, unknown>) => Parsed;
  /** The issue path prefix of the row's own keys. */
  readonly at: readonly PropertyKey[];
  readonly executorKey: 'actionType' | 'type';
  /** A page node (`action:button` / `action:icon`), whose object `params` is its static values. */
  readonly node: boolean;
}

const ROWS: readonly Row[] = [
  {
    name: 'action:button',
    parse: (action) => ActionButtonPropsSchema.safeParse({ label: 'Close', ...action }),
    at: [],
    executorKey: 'actionType',
    node: true,
  },
  {
    name: 'action:icon',
    parse: (action) => ActionIconPropsSchema.safeParse({ icon: 'check', label: 'Close', ...action }),
    at: [],
    executorKey: 'actionType',
    node: true,
  },
  {
    name: 'action:group member',
    parse: (action) => GROUP.safeParse({ actions: [{ label: 'Close', ...action }] }),
    at: ['actions', 0],
    executorKey: 'type',
    node: false,
  },
  {
    name: 'action:menu member',
    parse: (action) => MENU.safeParse({ actions: [{ label: 'Close', ...action }] }),
    at: ['actions', 0],
    executorKey: 'type',
    node: false,
  },
];

/** `ActionSchema`'s issues for the same keys, on a registered action. */
const actionIssues = (keys: Record<string, unknown>): Issue[] =>
  issuesOf(ActionSchema.safeParse({ name: 'close_task', label: 'Close', ...keys }));

/**
 * `ActionSchema`'s issue at `path` for the same keys. The action carries rules
 * a row does not (a bare `script` action needs a `body` or a `target`, a `url`
 * action a `target`), so its issue is found by path, not by position.
 */
const actionIssueAt = (keys: Record<string, unknown>, path: readonly PropertyKey[]): Issue => {
  const issue = actionIssues(keys).find((i) => i.path.join('.') === path.join('.'));
  expect(issue, `ActionSchema raises nothing at ${path.join('.')}`).toBeDefined();
  return issue as Issue;
};

/**
 * The action's text as a row spells its executor: the same text on a member,
 * whose executor key is `type` as the action's is; `actionType: '…'` on a node.
 */
const asRowSpells = (row: Row, actionText: string): string =>
  row.executorKey === 'type'
    ? actionText
    : actionText.replaceAll("a `type: '", "an `actionType: '").replaceAll("`type: '", "`actionType: '");

const UPDATE = { operation: 'update', patch: { status: 'done' } } as const;
const STATUS_PARAM = [{ name: 'status', type: 'text', label: 'Status' }];

// ===========================================================================
// §1 + §2. The five members, on every row
// ===========================================================================

interface Member {
  readonly title: string;
  /** The row's keys; `k` is the row's executor key. */
  readonly keys: (k: string) => Record<string, unknown>;
  /** Where the one issue lands, relative to the row. */
  readonly at: (k: string) => PropertyKey[];
  /** The same row made valid. */
  readonly control: (k: string) => Record<string, unknown>;
}

const MEMBERS: readonly Member[] = [
  {
    title: '1. `patch` without `operation`',
    keys: () => ({ patch: { status: 'done' } }),
    at: () => ['patch'],
    control: () => ({ ...UPDATE }),
  },
  {
    title: "2. `operation: 'update'` + `target`",
    keys: () => ({ ...UPDATE, target: 'close_task_handler' }),
    at: () => ['target'],
    control: () => ({ ...UPDATE }),
  },
  {
    title: "3. `operation: 'update'` + a `url` executor",
    keys: (k) => ({ ...UPDATE, [k]: 'url' }),
    at: (k) => [k],
    control: (k) => ({ ...UPDATE, [k]: 'script' }),
  },
  {
    title: "4. `operation: 'update'` with no `patch` and no `params`",
    keys: () => ({ operation: 'update' }),
    at: () => ['patch'],
    control: () => ({ operation: 'update', params: STATUS_PARAM }),
  },
  {
    title: "5. `operation: 'update'` + a `list_toolbar` location",
    keys: () => ({ ...UPDATE, locations: ['record_header', 'list_toolbar'] }),
    at: () => ['locations', 1],
    control: () => ({ ...UPDATE, locations: ['record_header'] }),
  },
];

const ROW_MEMBERS = ROWS.flatMap((row) => MEMBERS.map((member) => [row.name, member.title, row, member] as const));

describe('the five declarative-update shapes the rows accepted while `ActionSchema` refused them', () => {
  it.each(ROW_MEMBERS)('REFUSAL: %s, member %s, is ONE issue at its key', (_name, _title, row, member) => {
    const issues = issuesOf(row.parse(member.keys(row.executorKey)));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', [...row.at, ...member.at(row.executorKey)]]]);
  });

  it.each(ROW_MEMBERS)('CONTROL: %s, member %s, made valid, parses', (_name, _title, row, member) => {
    const r = row.parse(member.control(row.executorKey));
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
  });

  it.each(MEMBERS)('the action refuses member $title at the same key (the family premise)', (member) => {
    expect(actionIssueAt(member.keys('type'), member.at('type')).code).toBe('custom');
  });
});

describe("ONE TEXT: a row's refusal is `ActionSchema`'s, with the executor spelled as the row spells it", () => {
  // Member 3's text is the one with a row clause (a row's key has no default);
  // it is judged on its own below.
  const SAME_TEXT = MEMBERS.filter((member) => !member.title.startsWith('3.'));

  it.each(ROWS.flatMap((row) => SAME_TEXT.map((member) => [row.name, member.title, row, member] as const)))(
    '%s, member %s',
    (_name, _title, row, member) => {
      const [rowIssue] = issuesOf(row.parse(member.keys(row.executorKey)));
      const actionIssue = actionIssueAt(member.keys('type'), member.at('type'));
      expect(rowIssue.message).toBe(asRowSpells(row, actionIssue.message));
    },
  );

  it.each(ROWS)("$name: member 3 names the row's executor spelling, and no default the row does not have", (row) => {
    const [issue] = issuesOf(row.parse({ ...UPDATE, [row.executorKey]: 'url' }));
    expect(issue.message).toContain(`\`${row.executorKey}: 'url'\``);
    expect(issue.message).toContain(`\`${row.executorKey}: 'script'\``);
    expect(issue.message).not.toContain('default');
    // The action's own text keeps its default clause (`action-row-update.test.ts`).
    expect(actionIssueAt({ ...UPDATE, type: 'url' }, ['type']).message).toContain("stays at its default `'script'`");
  });

  it.each(ROWS)('$name: on a node the spelling is `actionType`, never `type`', (row) => {
    const [issue] = issuesOf(row.parse({ ...UPDATE, target: 'close_task_handler' }));
    if (row.executorKey === 'actionType') {
      expect(issue.message).toContain("`actionType: 'api'`");
      expect(issue.message).not.toContain("`type: '");
    } else {
      expect(issue.message).toContain("`type: 'api'`");
    }
  });
});

// ===========================================================================
// §3. The rest of the set
// ===========================================================================

/** The refused-key table's keys each row declares, with a value of the key's own shape. */
const DECLARED_REFUSED: ReadonlyArray<readonly [key: string, value: unknown, onNodeOnly: string | undefined]> = [
  ['method', 'PATCH', undefined],
  ['bodyExtra', { status: 'done' }, undefined],
  ['bodyShape', { wrap: 'data' }, undefined],
  ['recordIdField', 'token', 'action:button'],
];

describe("the refused-key table's other row keys, beside `operation: 'update'`", () => {
  const cases = ROWS.flatMap((row) =>
    DECLARED_REFUSED.filter(([, , only]) => only === undefined || only === row.name)
      .map(([key, value]) => [row.name, key, row, key, value] as const));

  it.each(cases)('REFUSAL: %s with `%s` is ONE issue at that key, with the action\'s text', (_name, _key, row, key, value) => {
    const issues = issuesOf(row.parse({ ...UPDATE, [key]: value }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', [...row.at, key]]]);
    expect(issues[0].message).toBe(asRowSpells(row, actionIssueAt({ ...UPDATE, [key]: value }, [key]).message));
  });

  it.each(cases)('CONTROL: %s with `%s` and no `operation` parses', (_name, _key, row, key, value) => {
    const r = row.parse({ [row.executorKey]: 'api', target: '/api/v1/close', [key]: value });
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
  });

  it.each(ROWS)('$name: a table key the row does not declare is refused as unknown, before the judge runs', (row) => {
    const undeclared = ['body', 'recordIdParam', 'outcomeMessages', 'opensInNewTab', 'newTabUrl',
      ...(row.name === 'action:button' ? [] : ['recordIdField'])];
    for (const key of undeclared) {
      const issues = issuesOf(row.parse({ ...UPDATE, [key]: 'x' }));
      expect(issues.map((i) => [i.code, i.path]), key).toEqual([['unrecognized_keys', [...row.at]]]);
    }
  });
});

describe("the executor rule's edges on a row", () => {
  it.each(ROWS)("$name: `'script'`, an empty key and no key are accepted beside the operation", (row) => {
    for (const executor of ['script', '', undefined]) {
      const r = row.parse({ ...UPDATE, ...(executor === undefined ? {} : { [row.executorKey]: executor }) });
      expect(r.success, `${String(executor)}: ${JSON.stringify(issuesOf(r))}`).toBe(true);
    }
  });

  it.each(ROWS)('$name: every other executor is refused at the key, a host handler included', (row) => {
    for (const executor of ['url', 'modal', 'flow', 'api', 'form', 'run']) {
      const issues = issuesOf(row.parse({ ...UPDATE, [row.executorKey]: executor }));
      expect(issues.map((i) => [i.code, i.path]), executor).toEqual([['custom', [...row.at, row.executorKey]]]);
    }
  });
});

describe('`params` as the source of the values to write', () => {
  it.each(ROWS)('$name: a non-empty input list counts; an empty one does not', (row) => {
    expect(row.parse({ operation: 'update', params: STATUS_PARAM }).success).toBe(true);
    const issues = issuesOf(row.parse({ operation: 'update', params: [] }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', [...row.at, 'patch']]]);
  });

  it.each(ROWS.filter((row) => row.node))(
    '$name: a non-empty static-values object counts (it IS `properties.params`, merged by the write); an empty one does not',
    (row) => {
      const r = row.parse({ operation: 'update', params: { status: 'done' } });
      expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
      const issues = issuesOf(row.parse({ operation: 'update', params: {} }));
      expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', [...row.at, 'patch']]]);
    },
  );

  it.each(ROWS.filter((row) => !row.node))(
    '$name: an object `params` does not count — the container never forwards it to a non-`api` executor',
    (row) => {
      const issues = issuesOf(row.parse({ operation: 'update', params: { status: 'done' } }));
      expect(issues.map((i) => [i.code, i.path]).sort()).toEqual([
        ['custom', [...row.at, 'params']],
        ['custom', [...row.at, 'patch']],
      ].sort());
    },
  );
});

describe("a row's `patch` is `ActionSchema`'s own record of field values", () => {
  type Shape = { shape: Record<string, z.ZodOptional<z.ZodType>> };
  const memberOf = (props: unknown) =>
    ((props as Shape).shape.actions.unwrap() as unknown as z.ZodArray<z.ZodType>).element as unknown as Shape;

  it('NO SECOND SHAPE: every row holds the very schema instance `ActionSchema.patch` declares', () => {
    const patch = ActionSchema.in.shape.patch.unwrap();
    expect((ActionButtonPropsSchema as unknown as Shape).shape.patch.unwrap()).toBe(patch);
    expect((ActionIconPropsSchema as unknown as Shape).shape.patch.unwrap()).toBe(patch);
    expect(memberOf(GROUP).shape.patch.unwrap()).toBe(patch);
    expect(memberOf(MENU).shape.patch.unwrap()).toBe(patch);
  });

  it.each(ROWS)('$name: a `patch` that is not a record is refused at `patch` — the runner drops it before the write', (row) => {
    for (const patch of ['done', ['status', 'done'], 1]) {
      const issues = issuesOf(row.parse({ operation: 'update', patch }));
      expect(issues.map((i) => [i.code, i.path]), JSON.stringify(patch)).toEqual([['invalid_type', [...row.at, 'patch']]]);
    }
  });
});

// ===========================================================================
// §4. Operation first: the rows' executor-dependent judgments stand down
// ===========================================================================

describe('beside the operation, the url-target and executor-alias judgments stand down', () => {
  it.each(ROWS)('$name: a `url` executor and a `javascript:` target are refused as the update refuses them, not as a url target', (row) => {
    const issues = issuesOf(row.parse({ ...UPDATE, [row.executorKey]: 'url', target: 'javascript:alert(1)' }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ['custom', [...row.at, row.executorKey]],
      ['custom', [...row.at, 'target']],
    ]);
    expect(issues[1].message).toBe(asRowSpells(row, actionIssueAt({ ...UPDATE, target: 'javascript:alert(1)' }, ['target']).message));
  });

  it.each(ROWS)("$name: `'navigation'` is ONE issue, the update's, never a rename onto `'url'`", (row) => {
    const issues = issuesOf(row.parse({ ...UPDATE, [row.executorKey]: 'navigation' }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', [...row.at, row.executorKey]]]);
    expect(issues[0].message).toContain(`\`${row.executorKey}: 'navigation'\``);
  });

  it.each(ROWS)('$name: CONTROL — without the operation both judgments still fire', (row) => {
    const target = issuesOf(row.parse({ [row.executorKey]: 'url', target: 'javascript:alert(1)' }));
    expect(target.map((i) => [i.code, i.path])).toEqual([['custom', [...row.at, 'target']]]);
    const alias = issuesOf(row.parse({ [row.executorKey]: 'navigation', target: '/tasks' }));
    expect(alias.map((i) => [i.code, i.path])).toEqual([['custom', [...row.at, row.executorKey]]]);
  });
});

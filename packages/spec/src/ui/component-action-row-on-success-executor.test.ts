// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The page action rows — `action:button`, `action:icon` and an `action:group` /
 * `action:menu` member — on the two keys that still let a row carry a target the
 * console's action runner refuses at the click (ruling A+ on
 * objectstack-ai/objectui#12191: the scheme set is stated once in the contract
 * and the runtime fulfils exactly that):
 *
 * - **`onSuccess`** is `ActionSchema`'s own post-success block, by reference —
 *   so `navigate` is judged by the one grammar in `navigation-target.ts`, and
 *   the block's closed shape (its rename prescriptions, its closed `openIn`)
 *   comes with it. No second shape: the block on a row is the SAME instance
 *   `ActionSchema.onSuccess` declares, and a row's verdict on any `onSuccess`
 *   value is the action's.
 * - **The executor key** (`actionType` on a node, `type` on a member) refuses
 *   `'navigation'`, the runner's local alias of `'url'`, with the lossless
 *   rename onto `'url'` — whose `target` the url scheme set judges. Every other
 *   executor name, a host-registered handler included, stays open.
 *
 * Each row gets one refusal (its Zod issue path and its first sentence) and one
 * accepted control (a full parse). A page's `properties` bag is outside the
 * stack parse; `os validate` judges it through its props gate, which parses the
 * bag against these same rows — `@objectstack/lint`'s
 * `validate-component-props-row-on-success` test pins that door.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';

import { ActionSchema } from './action.zod';
import { ActionButtonPropsSchema, ActionIconPropsSchema, ComponentPropsMap } from './component.zod';

const NAVIGATE_SUBJECT = "An action's `onSuccess.navigate`";
const JAVASCRIPT_REST = ' opens with `javascript:`, a scheme a url target never opens.';

/** The message's first sentence: everything up to the first `. ` outside a code span. */
function firstSentence(message: string): string {
  let inCode = false;
  for (let i = 0; i < message.length; i += 1) {
    if (message[i] === '`') inCode = !inCode;
    if (!inCode && message[i] === '.' && (message[i + 1] === ' ' || i === message.length - 1)) {
      return message.slice(0, i + 1);
    }
  }
  return message;
}

type Issue = { code: string; path: PropertyKey[]; message: string };
const issuesOf = (r: { success: boolean; error?: { issues: unknown[] } }): Issue[] =>
  (r.success ? [] : (r.error?.issues ?? [])) as Issue[];

type Parser = { safeParse: (value: unknown) => { success: boolean; data?: unknown; error?: { issues: unknown[] } } };
const GROUP = ComponentPropsMap['action:group'] as unknown as Parser;
const MENU = ComponentPropsMap['action:menu'] as unknown as Parser;

/**
 * One row shape: how to write a row with the given action keys, where its keys
 * sit in an issue path, and how a refusal names its executor.
 */
interface Row {
  readonly name: string;
  readonly parse: (action: Record<string, unknown>) => ReturnType<Parser['safeParse']>;
  /** The issue path prefix of the row's own keys. */
  readonly at: readonly PropertyKey[];
  readonly executorKey: 'actionType' | 'type';
  readonly navigationSubject: string;
  /** The parsed row's action object. */
  readonly parsed: (data: unknown) => Record<string, unknown>;
}

const ROWS: readonly Row[] = [
  {
    name: 'action:button',
    parse: (action) => ActionButtonPropsSchema.safeParse({ label: 'Clone', ...action }),
    at: [],
    executorKey: 'actionType',
    navigationSubject: "An `action:button`'s `actionType: 'navigation'`",
    parsed: (data) => data as Record<string, unknown>,
  },
  {
    name: 'action:icon',
    parse: (action) => ActionIconPropsSchema.safeParse({ icon: 'copy', label: 'Clone', ...action }),
    at: [],
    executorKey: 'actionType',
    navigationSubject: "An `action:icon`'s `actionType: 'navigation'`",
    parsed: (data) => data as Record<string, unknown>,
  },
  {
    name: 'action:group member',
    parse: (action) => GROUP.safeParse({ actions: [{ label: 'Clone', ...action }] }),
    at: ['actions', 0],
    executorKey: 'type',
    navigationSubject: "An `action:group` member's `type: 'navigation'`",
    parsed: (data) => (data as { actions: Record<string, unknown>[] }).actions[0],
  },
  {
    name: 'action:menu member',
    parse: (action) => MENU.safeParse({ actions: [{ label: 'Clone', ...action }] }),
    at: ['actions', 0],
    executorKey: 'type',
    navigationSubject: "An `action:menu` member's `type: 'navigation'`",
    parsed: (data) => (data as { actions: Record<string, unknown>[] }).actions[0],
  },
];

/** An `api` row with the given `onSuccess`, spelled with the row's executor key. */
const apiRow = (row: Row, onSuccess: unknown) =>
  row.parse({ [row.executorKey]: 'api', target: '/api/v1/tasks/clone', onSuccess });

// ===========================================================================
// 1. onSuccess — ActionSchema's own block
// ===========================================================================

describe("a page action row's `onSuccess` is `ActionSchema`'s own post-success block", () => {
  it.each(ROWS)('REFUSAL: %s with `navigate: \'javascript:alert(1)\'` is refused at `onSuccess.navigate`', (row) => {
    const issues = issuesOf(apiRow(row, { navigate: 'javascript:alert(1)' }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', [...row.at, 'onSuccess', 'navigate']]]);
    expect(firstSentence(issues[0].message)).toBe(`${NAVIGATE_SUBJECT}${JAVASCRIPT_REST}`);
  });

  it.each(ROWS)('ACCEPTED CONTROL: %s with an in-app route template parses, `openIn` resolved as on the action', (row) => {
    const r = apiRow(row, { navigate: '/apps/crm/tasks/${result.id}' });
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
    expect(row.parsed(r.data).onSuccess).toEqual({ navigate: '/apps/crm/tasks/${result.id}', openIn: 'self' });
  });

  /**
   * The values a row's verdict is compared on: one per arm of the block's
   * judgement — the scheme set, the deferred template, the closed `openIn`,
   * the rename prescription, the missing `navigate`, and a value of the wrong
   * kind (the retired callback shapes the runner gives no reading).
   */
  const VERDICT_PROBES: ReadonlyArray<readonly [string, unknown]> = [
    ['an https URL, new tab', { navigate: 'https://example.com/receipt', openIn: 'newTab' }],
    ['a deferred template', { navigate: '${result.redirectUrl}' }],
    ['a bare relative template', { navigate: 'tasks/${result.id}' }],
    ['a protocol-relative host', { navigate: '//evil.example.com' }],
    ["`openIn: 'new-tab'` (the top-level spelling)", { navigate: '/x', openIn: 'new-tab' }],
    ['`url` for `navigate`', { url: '/x' }],
    ['no `navigate`', {}],
    ['a callback object', { type: 'notify', name: 'ping' }],
    ['a callback array', [{ type: 'notify' }]],
    ['a bare string', '/x'],
  ];

  /** The action's verdict on one `onSuccess` value, paths relative to the block. */
  const actionVerdict = (onSuccess: unknown) => {
    const r = ActionSchema.safeParse({
      name: 'clone_task', label: 'Clone', type: 'api', target: '/api/v1/tasks/clone', onSuccess,
    });
    return r.success
      ? { ok: true, onSuccess: (r.data as { onSuccess: unknown }).onSuccess }
      : { ok: false, issues: issuesOf(r).map((i) => [i.code, i.path.slice(1), i.message]) };
  };

  it.each(ROWS)('NO SECOND SHAPE: %s gives every probe the verdict `ActionSchema` gives it', (row) => {
    for (const [label, onSuccess] of VERDICT_PROBES) {
      const r = apiRow(row, onSuccess);
      const rowVerdict = r.success
        ? { ok: true, onSuccess: row.parsed(r.data).onSuccess }
        : { ok: false, issues: issuesOf(r).map((i) => [i.code, i.path.slice(row.at.length + 1), i.message]) };
      expect(rowVerdict, label).toEqual(actionVerdict(onSuccess));
    }
  });

  it('NO SECOND SHAPE: every row holds the very block instance `ActionSchema.onSuccess` declares', () => {
    const block = ActionSchema.in.shape.onSuccess.unwrap();
    type Shape = { shape: Record<string, z.ZodOptional<z.ZodType>> };
    const memberOf = (props: unknown) =>
      ((props as Shape).shape.actions.unwrap() as unknown as z.ZodArray<z.ZodType>).element as unknown as Shape;
    expect((ActionButtonPropsSchema as unknown as Shape).shape.onSuccess.unwrap()).toBe(block);
    expect((ActionIconPropsSchema as unknown as Shape).shape.onSuccess.unwrap()).toBe(block);
    expect(memberOf(GROUP).shape.onSuccess.unwrap()).toBe(block);
    expect(memberOf(MENU).shape.onSuccess.unwrap()).toBe(block);
  });
});

// ===========================================================================
// 2. The executor key — one spelling for the url executor
// ===========================================================================

describe("a page action row's executor key refuses `'navigation'`, the runner's alias of `'url'`", () => {
  it.each(ROWS)("REFUSAL: %s with the alias is refused at its executor key, with the rename onto `'url'`", (row) => {
    const issues = issuesOf(row.parse({ [row.executorKey]: 'navigation', target: '/apps/crm/tasks' }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', [...row.at, row.executorKey]]]);
    expect(firstSentence(issues[0].message)).toBe(
      `${row.navigationSubject} is the console runner's local alias of \`'url'\`, and the url executor has one spelling.`,
    );
    expect(issues[0].message).toContain(`Write \`${row.executorKey}: 'url'\``);
  });

  it.each(ROWS)("ACCEPTED CONTROL: %s with `'url'` and the same target parses unchanged", (row) => {
    const r = row.parse({ [row.executorKey]: 'url', target: '/apps/crm/tasks' });
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
    expect(row.parsed(r.data)[row.executorKey]).toBe('url');
  });

  it.each(ROWS)('CONTROL: %s keeps its executor key open — a host-registered handler name parses', (row) => {
    const r = row.parse({ [row.executorKey]: 'navigate_edit' });
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
  });
});

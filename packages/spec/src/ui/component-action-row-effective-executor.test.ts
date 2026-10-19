// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The page action rows — `action:button`, `action:icon` and an `action:group` /
 * `action:menu` member — judge their `target` against the executor the
 * console's action runner will RUN, not only against the executor key.
 *
 * The runner dispatches on `action.type || action.actionType || action.name`
 * (read points recorded in `liveness/page.json`, row `regions`), and every row
 * forwards its executor key as `type` beside its `name`.
 * So a row with no executor key whose `name` is `url` or `navigation` runs the
 * url navigator — and its `target` is judged by the one url-target grammar
 * (`navigation-target.ts`), whichever key spelled the executor. ⛔ `name` is
 * not refused as an executor spelling: a row whose `name` names any other
 * handler is untouched. ⛔ No second URL grammar.
 *
 * Each pin is one refusal (its issue path and first sentence) or one accepted
 * control (a full parse). `os validate`'s props gate parses a page's
 * `properties` against these same rows; `@objectstack/lint`'s
 * `validate-component-props-url-target` test pins that door.
 */

import { describe, it, expect } from 'vitest';

import { ActionButtonPropsSchema, ActionIconPropsSchema, ComponentPropsMap } from './component.zod';

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

type Parser = { safeParse: (value: unknown) => { success: boolean; error?: { issues: unknown[] } } };
const GROUP = ComponentPropsMap['action:group'] as unknown as Parser;
const MENU = ComponentPropsMap['action:menu'] as unknown as Parser;

/** One row shape: how to write it, where its keys sit in an issue path, and how a refusal names it. */
interface Row {
  readonly row: string;
  readonly parse: (action: Record<string, unknown>) => Issue[];
  readonly at: readonly PropertyKey[];
  readonly executorKey: 'actionType' | 'type';
  /** The refusal subject's opening, before `` `target` ``. */
  readonly owner: string;
}

const ROWS: readonly Row[] = [
  {
    row: 'action:button',
    parse: (action) => issuesOf(ActionButtonPropsSchema.safeParse({ label: 'Open', ...action })),
    at: [],
    executorKey: 'actionType',
    owner: "An `action:button`'s",
  },
  {
    row: 'action:icon',
    parse: (action) => issuesOf(ActionIconPropsSchema.safeParse({ label: 'Open', ...action })),
    at: [],
    executorKey: 'actionType',
    owner: "An `action:icon`'s",
  },
  {
    row: 'action:group member',
    parse: (action) => issuesOf(GROUP.safeParse({ actions: [{ label: 'Open', ...action }] })),
    at: ['actions', 0],
    executorKey: 'type',
    owner: "An `action:group` member's",
  },
  {
    row: 'action:menu member',
    parse: (action) => issuesOf(MENU.safeParse({ actions: [{ label: 'Open', ...action }] })),
    at: ['actions', 0],
    executorKey: 'type',
    owner: "An `action:menu` member's",
  },
];

/** Every row crossed with each name-leg spelling of the url navigator. */
const NAME_LEG = ROWS.flatMap((r) => (['url', 'navigation'] as const).map((name) => ({ ...r, name })));

describe("a page action row's `target` is judged on the executor the runner runs — the name leg", () => {
  it.each(NAME_LEG)(
    "REFUSAL: $row with `name: '$name'` and no executor key, `javascript:alert(1)`, is refused at `target`",
    ({ parse, at, executorKey, owner, name }) => {
      const issues = parse({ name, target: 'javascript:alert(1)' });
      expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', [...at, 'target']]]);
      expect(firstSentence(issues[0].message)).toBe(
        `${owner} \`target\` (\`name: '${name}'\` and no \`${executorKey}\`, so the runner runs the url navigator)`
          + JAVASCRIPT_REST,
      );
    },
  );

  it.each(ROWS)(
    'REFUSAL: $row with an EMPTY executor key falls through to `name`, as the runner\'s `||` does',
    ({ parse, at, executorKey, owner }) => {
      const issues = parse({ [executorKey]: '', name: 'url', target: 'javascript:alert(1)' });
      expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', [...at, 'target']]]);
      expect(firstSentence(issues[0].message)).toBe(
        `${owner} \`target\` (\`name: 'url'\` and an empty \`${executorKey}\`, so the runner runs the url navigator)`
          + JAVASCRIPT_REST,
      );
    },
  );

  it.each(NAME_LEG)("ACCEPTED CONTROL: $row with `name: '$name'` and an admitted target parses", ({ parse, name }) => {
    for (const target of ['https://example.com/docs', '/apps/crm', './tasks', 'mailto:sales@example.com', '${ctx.origin}/x']) {
      expect(parse({ name, target }), `${name} ${target}`).toEqual([]);
    }
  });

  it.each(NAME_LEG)("CONTROL: $row with `name: '$name'` and no `target` is not judged", ({ parse, name }) => {
    expect(parse({ name })).toEqual([]);
  });
});

describe('the executor key outranks the name, as at the runner', () => {
  it.each(ROWS)(
    "CONTROL: $row with `'url'` at its executor key keeps the refusal it always had, whatever the name",
    ({ parse, at, executorKey, owner }) => {
      const issues = parse({ [executorKey]: 'url', name: 'convert_lead', target: 'javascript:alert(1)' });
      expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', [...at, 'target']]]);
      expect(firstSentence(issues[0].message)).toBe(`${owner} \`target\` (\`${executorKey}: 'url'\`)${JAVASCRIPT_REST}`);
    },
  );

  it.each(ROWS)(
    "CONTROL: $row with a non-url executor key and `name: 'url'` leaves `target` alone",
    ({ parse, executorKey }) => {
      for (const value of ['flow', 'script', 'api', 'modal', 'form', 'navigate_edit']) {
        expect(parse({ [executorKey]: value, name: 'url', target: 'convert_lead' }), value).toEqual([]);
      }
    },
  );

  it.each(ROWS)(
    "REFUSAL: $row with `'navigation'` at its executor key is refused at the key AND judged at `target`",
    ({ parse, at, executorKey, owner }) => {
      const issues = parse({ [executorKey]: 'navigation', target: 'javascript:alert(1)' });
      const byPath = Object.fromEntries(issues.map((i) => [i.path.join('.'), i]));
      expect(Object.keys(byPath).sort()).toEqual([[...at, executorKey].join('.'), [...at, 'target'].join('.')].sort());
      expect(firstSentence(byPath[[...at, 'target'].join('.')].message))
        .toBe(`${owner} \`target\` (\`${executorKey}: 'navigation'\`)${JAVASCRIPT_REST}`);
    },
  );
});

describe("a row whose `name` names another handler is that handler's business", () => {
  it.each(ROWS)("CONTROL: $row with no executor key and a non-url `name` leaves `target` alone", ({ parse }) => {
    for (const name of ['navigate_edit', 'navigate_create', 'convert_lead', 'flow', 'api', 'URL']) {
      expect(parse({ name, target: 'convert_lead' }), name).toEqual([]);
    }
    expect(parse({ target: 'convert_lead' }), 'no executor key and no name').toEqual([]);
  });
});

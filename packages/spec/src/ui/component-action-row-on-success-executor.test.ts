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
 * - **`onSuccess` beside the effective executor** (section 3): `ActionSchema`'s
 *   "`onSuccess` only beside `api` / `script`", carried to the rows on the
 *   vocabulary the action's closed `ActionType` can see. Refused beside every
 *   runner built-in other than those two (`url`, `navigation`, `modal`,
 *   `flow`, `form`) and beside a row with no effective executor; a host
 *   handler name stays open; the refusal text is the action's own.
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
  /** How a refusal on one of the row's own keys opens ("An `action:button`'s"). */
  readonly owner: string;
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
    owner: "An `action:button`'s",
    parsed: (data) => data as Record<string, unknown>,
  },
  {
    name: 'action:icon',
    parse: (action) => ActionIconPropsSchema.safeParse({ icon: 'copy', label: 'Clone', ...action }),
    at: [],
    executorKey: 'actionType',
    navigationSubject: "An `action:icon`'s `actionType: 'navigation'`",
    owner: "An `action:icon`'s",
    parsed: (data) => data as Record<string, unknown>,
  },
  {
    name: 'action:group member',
    parse: (action) => GROUP.safeParse({ actions: [{ label: 'Clone', ...action }] }),
    at: ['actions', 0],
    executorKey: 'type',
    navigationSubject: "An `action:group` member's `type: 'navigation'`",
    owner: "An `action:group` member's",
    parsed: (data) => (data as { actions: Record<string, unknown>[] }).actions[0],
  },
  {
    name: 'action:menu member',
    parse: (action) => MENU.safeParse({ actions: [{ label: 'Clone', ...action }] }),
    at: ['actions', 0],
    executorKey: 'type',
    navigationSubject: "An `action:menu` member's `type: 'navigation'`",
    owner: "An `action:menu` member's",
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
  it.each(ROWS)('REFUSAL: $name with `navigate: \'javascript:alert(1)\'` is refused at `onSuccess.navigate`', (row) => {
    const issues = issuesOf(apiRow(row, { navigate: 'javascript:alert(1)' }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', [...row.at, 'onSuccess', 'navigate']]]);
    expect(firstSentence(issues[0].message)).toBe(`${NAVIGATE_SUBJECT}${JAVASCRIPT_REST}`);
  });

  it.each(ROWS)('ACCEPTED CONTROL: $name with an in-app route template parses, `openIn` resolved as on the action', (row) => {
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

  it.each(ROWS)('NO SECOND SHAPE: $name gives every probe the verdict `ActionSchema` gives it', (row) => {
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
  it.each(ROWS)("REFUSAL: $name with the alias is refused at its executor key, with the rename onto `'url'`", (row) => {
    const issues = issuesOf(row.parse({ [row.executorKey]: 'navigation', target: '/apps/crm/tasks' }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', [...row.at, row.executorKey]]]);
    expect(firstSentence(issues[0].message)).toBe(
      `${row.navigationSubject} is the console runner's local alias of \`'url'\`, refused on page action rows since @objectstack/spec 18, and the url executor has one spelling.`,
    );
    expect(issues[0].message).toContain(`Write \`${row.executorKey}: 'url'\``);
  });

  it.each(ROWS)("ACCEPTED CONTROL: $name with `'url'` and the same target parses unchanged", (row) => {
    const r = row.parse({ [row.executorKey]: 'url', target: '/apps/crm/tasks' });
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
    expect(row.parsed(r.data)[row.executorKey]).toBe('url');
  });

  it.each(ROWS)('CONTROL: $name keeps its executor key open — a host-registered handler name parses', (row) => {
    const r = row.parse({ [row.executorKey]: 'navigate_edit' });
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
  });
});

// ===========================================================================
// 3. onSuccess beside the effective executor — ActionSchema's own rule
// ===========================================================================

/** The row's subject for an issue on `onSuccess`, given the spelling that resolved its executor. */
const onSuccessSubject = (row: Row, spelled: string) => `${row.owner} \`onSuccess\` (${spelled})`;

/** A target each executor takes without a refusal of its own. */
const TARGETS: Readonly<Record<string, string>> = {
  url: '/apps/crm/tasks',
  navigation: '/apps/crm/tasks',
  modal: 'task_modal',
  flow: 'close_task',
  form: 'task_form',
  api: '/api/v1/tasks/clone',
  script: 'clone_task_fn',
  run: 'clone_task',
};

const HOP = { navigate: '/apps/crm/tasks/${result.id}' };

describe("a page action row's `onSuccess` is refused beside a runner built-in other than `api` / `script`", () => {
  const REFUSED = ['url', 'modal', 'flow', 'form'] as const;

  it.each(ROWS.flatMap((row) => REFUSED.map((executor) => [row.name, executor, row] as const)))(
    'REFUSAL: %s with `%s` and `onSuccess` is refused at `onSuccess`, naming the row and its executor',
    (_name, executor, row) => {
      const issues = issuesOf(row.parse({ [row.executorKey]: executor, target: TARGETS[executor], onSuccess: HOP }));
      expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', [...row.at, 'onSuccess']]]);
      expect(issues[0].message.startsWith(onSuccessSubject(row, `\`${row.executorKey}: '${executor}'\``))).toBe(true);
    },
  );

  it.each(ROWS.flatMap((row) => REFUSED.map((executor) => [row.name, executor, row] as const)))(
    'NEGATIVE CONTROL: %s with `%s` and no `onSuccess` parses',
    (_name, executor, row) => {
      const r = row.parse({ [row.executorKey]: executor, target: TARGETS[executor] });
      expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
    },
  );

  it.each(ROWS)("REFUSAL: $name with `'navigation'` and `onSuccess` gets the alias refusal AND the `onSuccess` one", (row) => {
    const issues = issuesOf(row.parse({ [row.executorKey]: 'navigation', target: TARGETS.navigation, onSuccess: HOP }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ['custom', [...row.at, row.executorKey]],
      ['custom', [...row.at, 'onSuccess']],
    ]);
    expect(issues[1].message.startsWith(onSuccessSubject(row, `\`${row.executorKey}: 'navigation'\``))).toBe(true);
  });

  it.each(ROWS.flatMap((row) => REFUSED.map((executor) => [row.name, executor, row] as const)))(
    "ONE TEXT: %s with `%s` gives `ActionSchema`'s own refusal, after the subject",
    (_name, executor, row) => {
      const rowMessage = issuesOf(row.parse({ [row.executorKey]: executor, target: TARGETS[executor], onSuccess: HOP }))[0].message;
      const actionIssues = issuesOf(ActionSchema.safeParse({
        name: 'clone_task', label: 'Clone', type: executor, target: TARGETS[executor], onSuccess: HOP,
      }));
      expect(actionIssues.map((i) => [i.code, i.path])).toEqual([['custom', ['onSuccess']]]);
      const actionSubject = `A \`type: '${executor}'\` action's \`onSuccess\``;
      expect(actionIssues[0].message.startsWith(actionSubject)).toBe(true);
      const rowSubject = onSuccessSubject(row, `\`${row.executorKey}: '${executor}'\``);
      expect(rowMessage.slice(rowSubject.length)).toBe(actionIssues[0].message.slice(actionSubject.length));
    },
  );

  it.each(ROWS)('REFUSAL: $name on the name leg — no executor key and `name: \'form\'` — is refused as `form`', (row) => {
    const issues = issuesOf(row.parse({ name: 'form', target: TARGETS.form, onSuccess: HOP }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', [...row.at, 'onSuccess']]]);
    expect(issues[0].message.startsWith(
      onSuccessSubject(row, `\`name: 'form'\` and no \`${row.executorKey}\`, so the runner runs \`form\``),
    )).toBe(true);
  });
});

describe("a page action row's `onSuccess` is refused beside no effective executor", () => {
  it.each(ROWS)('REFUSAL: $name with no executor key and no `name` is refused at `onSuccess`', (row) => {
    const issues = issuesOf(row.parse({ onSuccess: HOP }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', [...row.at, 'onSuccess']]]);
    expect(issues[0].message.startsWith(onSuccessSubject(row, `no \`${row.executorKey}\` and no \`name\``))).toBe(true);
    expect(issues[0].message).toContain(`\`${row.executorKey}: 'api'\``);
  });

  it.each(ROWS)('REFUSAL: $name with an EMPTY executor key and no `name` is refused too — the runner reads `||`', (row) => {
    const issues = issuesOf(row.parse({ [row.executorKey]: '', onSuccess: HOP }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', [...row.at, 'onSuccess']]]);
    expect(issues[0].message.startsWith(onSuccessSubject(row, `an empty \`${row.executorKey}\` and no \`name\``))).toBe(true);
  });

  it.each(ROWS)('NEGATIVE CONTROL: $name with no executor and no `onSuccess` parses', (row) => {
    const r = row.parse({});
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
  });
});

describe("a page action row's `onSuccess` stays open beside `api`, `script` and a host-registered handler", () => {
  it.each(ROWS.flatMap((row) => (['api', 'script', 'run'] as const).map((executor) => [row.name, executor, row] as const)))(
    'ACCEPTED: %s with `%s` and `onSuccess` parses, the block resolved as on the action',
    (_name, executor, row) => {
      const r = row.parse({ [row.executorKey]: executor, target: TARGETS[executor], onSuccess: HOP });
      expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
      expect(row.parsed(r.data).onSuccess).toEqual({ ...HOP, openIn: 'self' });
    },
  );

  it.each(ROWS)('ACCEPTED: $name on the name leg — no executor key and `name: \'api\'` or a host handler name — parses', (row) => {
    for (const name of ['api', 'script', 'clone_task']) {
      const r = row.parse({ name, onSuccess: HOP });
      expect(r.success, `${name}: ${JSON.stringify(issuesOf(r))}`).toBe(true);
    }
    const empty = row.parse({ [row.executorKey]: '', name: 'api', onSuccess: HOP });
    expect(empty.success, JSON.stringify(issuesOf(empty))).toBe(true);
  });

  it.each(ROWS)('ACCEPTED: $name with a declared executor key outranks its `name` — `api` named `url` parses', (row) => {
    const r = row.parse({ [row.executorKey]: 'api', name: 'url', target: TARGETS.api, onSuccess: HOP });
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
  });

  it.each(ROWS)('NEGATIVE CONTROL: $name with a declared `form` key still refuses its `name: \'api\'` row\'s `onSuccess`', (row) => {
    const issues = issuesOf(row.parse({ [row.executorKey]: 'form', name: 'api', target: TARGETS.form, onSuccess: HOP }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', [...row.at, 'onSuccess']]]);
  });
});

// ===========================================================================
// 4. operation — ActionSchema's own enum, and its `onSuccess` rule
// ===========================================================================

/** A declarative update row: `operation: 'update'` with a static `patch`. */
const UPDATE = { operation: 'update', patch: { status: 'done' } } as const;

/** `ActionSchema`'s refusal of `onSuccess` beside `operation: 'update'`, and the subject it opens with. */
const ACTION_UPDATE_SUBJECT = "An `operation: 'update'` action's `onSuccess`";
const actionUpdateOnSuccessMessage = (): string => {
  const issues = issuesOf(ActionSchema.safeParse({
    name: 'close_task', label: 'Close', ...UPDATE, onSuccess: HOP,
  }));
  expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['onSuccess']]]);
  expect(issues[0].message.startsWith(ACTION_UPDATE_SUBJECT)).toBe(true);
  return issues[0].message;
};

describe("a page action row's `operation` is `ActionSchema`'s own enum", () => {
  it('NO SECOND VOCABULARY: every row holds the very enum instance `ActionSchema.operation` declares', () => {
    const operation = ActionSchema.in.shape.operation.unwrap();
    type Shape = { shape: Record<string, z.ZodOptional<z.ZodType>> };
    const memberOf = (props: unknown) =>
      ((props as Shape).shape.actions.unwrap() as unknown as z.ZodArray<z.ZodType>).element as unknown as Shape;
    expect((ActionButtonPropsSchema as unknown as Shape).shape.operation.unwrap()).toBe(operation);
    expect((ActionIconPropsSchema as unknown as Shape).shape.operation.unwrap()).toBe(operation);
    expect(memberOf(GROUP).shape.operation.unwrap()).toBe(operation);
    expect(memberOf(MENU).shape.operation.unwrap()).toBe(operation);
  });

  it.each(ROWS)("REFUSAL: $name with `operation: 'delete'` is refused at `operation` with the action's own text", (row) => {
    const issues = issuesOf(row.parse({ operation: 'delete', patch: { status: 'done' } }));
    expect(issues.map((i) => i.path)).toEqual([[...row.at, 'operation']]);
    const action = issuesOf(ActionSchema.safeParse({ name: 'x', label: 'X', operation: 'delete', patch: { status: 'done' } }))
      .find((i) => i.path.join('.') === 'operation');
    expect(issues[0].message).toBe(action?.message);
    expect(issues[0].message.startsWith("`operation: 'delete'` is a bulk-def operation with no row-level form")).toBe(true);
  });

  it.each(ROWS)("REFUSAL: $name with `operation: 'create'` (no member) is refused at `operation`", (row) => {
    const issues = issuesOf(row.parse({ operation: 'create', patch: { status: 'done' } }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['invalid_value', [...row.at, 'operation']]]);
  });

  it.each(ROWS)("ACCEPTED CONTROL: $name with `operation: 'update'` and a `patch` parses unchanged", (row) => {
    const r = row.parse({ ...UPDATE });
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
    expect(row.parsed(r.data).operation).toBe('update');
  });
});

describe("a page action row's `onSuccess` is refused beside `operation: 'update'`, as `ActionSchema` refuses it", () => {
  /**
   * The two executors a row may name beside `operation: 'update'`: none, and
   * `'script'`, the route the write is posted to. Every other executor beside
   * it is refused at the executor key by the declarative-update judge, pinned
   * in `component-action-row-declarative-update.test.ts`.
   */
  const BESIDE = [undefined, 'script'] as const;
  const updateRow = (row: Row, executor: string | undefined, extra: Record<string, unknown> = {}) =>
    row.parse({ ...(executor === undefined ? {} : { [row.executorKey]: executor }), ...UPDATE, ...extra });
  const updateSubject = (row: Row) => onSuccessSubject(row, "`operation: 'update'`");

  it.each(ROWS.flatMap((row) => BESIDE.map((executor) => [row.name, String(executor), row, executor] as const)))(
    'REFUSAL: %s with executor %s, `operation: \'update\'` and `onSuccess` is refused at `onSuccess`, ONE issue',
    (_name, _label, row, executor) => {
      const issues = issuesOf(updateRow(row, executor, { onSuccess: HOP }));
      expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', [...row.at, 'onSuccess']]]);
      expect(firstSentence(issues[0].message)).toBe(
        `${updateSubject(row)} would follow a result the contract does not declare: the console's action runner reads `
        + "`operation` before any executor, so an `operation: 'update'` action runs no handler and no executor of its "
        + 'own (the platform action route writes `patch` to the current record as the caller), and the runner then '
        + 'performs the post-success hop after that write succeeds.',
      );
    },
  );

  it.each(ROWS.flatMap((row) => BESIDE.map((executor) => [row.name, String(executor), row, executor] as const)))(
    'NEGATIVE CONTROL: %s with executor %s and `operation: \'update\'` and no `onSuccess` parses',
    (_name, _label, row, executor) => {
      const r = updateRow(row, executor);
      expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
    },
  );

  it.each(ROWS)("ONE TEXT: $name gives `ActionSchema`'s own refusal of the pairing, after the subject", (row) => {
    const rowMessage = issuesOf(updateRow(row, 'script', { onSuccess: HOP }))[0].message;
    expect(rowMessage.slice(updateSubject(row).length))
      .toBe(actionUpdateOnSuccessMessage().slice(ACTION_UPDATE_SUBJECT.length));
  });
});

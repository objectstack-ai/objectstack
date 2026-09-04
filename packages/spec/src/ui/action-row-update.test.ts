// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14092 — the row-level declarative single-record field write.
 *
 * A list view's `bulkActionDefs` `{ operation: 'update', patch, visible }` has
 * always been fully declarative: the write runs on the data plane under the
 * caller's own permissions, hooks and validations fire, and `patch` merges
 * under the collected params. The identical intent on ONE row — the most
 * common action in any app — had no declarative form, so every app hand-wrote
 * a system-elevated handler and re-established that authorization by hand.
 * Maintainer ruling 2026-09-01: the row action gets the def's counterpart,
 * spelled with the same words.
 *
 * What these tests pin, in the order the PR body designs it:
 *
 *  - ACCEPT: the card's `duly` shape on an object-embedded action and on a
 *    standalone action with `objectName`; `patch` reaches the parsed shape
 *    verbatim (no transform).
 *  - KEY SHAPE: `operation` is a parallel key beside `type` — `ActionType` has
 *    no `update` member, `type` stays at its default `'script'` (the platform
 *    action route the write is performed on), and `type: 'update'` is refused
 *    with the prescription.
 *  - MIXING RULE: every executor-binding key beside `operation: 'update'` is
 *    refused at ITS path with code `custom` and a message whose first sentence
 *    names the executor the key belongs to; `patch` without the operation and
 *    `operation: 'update'` with nothing to write are refused; `list_toolbar`
 *    is refused; the bulk-only operations are refused with the reason.
 *  - BOUNDARIES: an inline page-element action cannot carry the keys; a
 *    standalone action without `objectName` is refused by `defineStack`; the
 *    bulk def's own vocabulary is untouched (mirrored, not moved).
 *
 * Refusals assert path + code + message substance, never a bare
 * `success === false` — a refusal that fires for the wrong reason reads green
 * here and sends the author looking for a different bug.
 */

import { describe, expect, it } from 'vitest';
import { ActionSchema, ActionType, InlineActionSchema, defineAction } from './action.zod';
import { BulkActionDefSchema } from './bulk-action.zod';
import { ObjectSchema } from '../data/object.zod';
import { defineStack } from '../stack.zod';

/** The card's shape, verbatim from the `duly` app that filed it. */
const duly = {
  name: 'duly_task_complete',
  label: 'Complete',
  operation: 'update' as const,
  patch: { status: 'done' },
  visible: 'record.status == "open" || record.status == "in_progress"',
};

const taskObject = {
  name: 'duly_task',
  label: 'Task',
  fields: {
    title: { type: 'text' as const },
    status: {
      type: 'select' as const,
      options: [
        { label: 'Open', value: 'open' },
        { label: 'In progress', value: 'in_progress' },
        { label: 'Done', value: 'done' },
      ],
    },
  },
};

const manifest = { id: 'com.example.duly', name: 'duly', version: '1.0.0', type: 'app' as const };

type Parsed = ReturnType<typeof ActionSchema.safeParse>;

/** The issue at exactly this path, or undefined when the parse succeeded / did not fire there. */
const issueAt = (result: Parsed, path: string) =>
  result.success ? undefined : result.error.issues.find((i) => i.path.join('.') === path);

const paths = (result: Parsed): string[] =>
  result.success ? [] : result.error.issues.map((i) => i.path.join('.')).sort();

/** `defineStack`'s refusal lines, or [] when it built. */
function stackRefusals(config: unknown): string[] {
  try {
    defineStack(config as Parameters<typeof defineStack>[0]);
    return [];
  } catch (error) {
    return String((error as Error).message)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('✗'));
  }
}

describe('#14092 — `operation: \'update\'` + `patch` is accepted (the bulk def\'s vocabulary, mirrored)', () => {
  it('accepts the duly shape on a standalone action that names its object', () => {
    const parsed = ActionSchema.parse({ ...duly, objectName: 'duly_task' });
    expect(parsed.operation).toBe('update');
    expect(parsed.patch).toEqual({ status: 'done' });
    expect(parsed.objectName).toBe('duly_task');
    // The route the write is performed on: `type` keeps its materialized
    // default — the key-shape decision, pinned again below on `ActionType`.
    expect(parsed.type).toBe('script');
    expect(parsed.visible).toEqual({ dialect: 'cel', source: duly.visible });
  });

  it('accepts the duly shape embedded on the object (the object binds it; no objectName needed)', () => {
    const object = ObjectSchema.parse({ ...taskObject, actions: [duly] });
    const action = object.actions?.[0];
    expect(action?.operation).toBe('update');
    expect(action?.patch).toEqual({ status: 'done' });
    expect(action?.objectName).toBeUndefined();
  });

  it('reuses the action\'s own params / undoable / confirmText keys — nothing duplicated', () => {
    const parsed = ActionSchema.parse({
      ...duly,
      objectName: 'duly_task',
      patch: { status: 'done', closed_by_ai: false },
      params: [{ name: 'note', label: 'Closing note', type: 'textarea' as const }],
      undoable: true,
    });
    expect(parsed.params?.[0]).toMatchObject({ name: 'note', type: 'textarea' });
    expect(parsed.undoable).toBe(true);
    // `confirmText` is legal on the param-LESS form — the #7428 pair rule is
    // unchanged and composes (pinned in the mixing-rule block below).
    expect(ActionSchema.safeParse({ ...duly, confirmText: 'Mark this task done?' }).success).toBe(true);
  });

  it('passes `patch` through verbatim — the parsed record IS the authored record, no transform', () => {
    const patch = { status: 'done', priority: 3, tags: ['a', 'b'], due: null, meta: { nested: true, n: 0 } };
    const parsed = ActionSchema.parse({ ...duly, patch });
    expect(parsed.patch).toEqual(patch);
    expect(Object.keys(parsed.patch ?? {})).toEqual(Object.keys(patch));
    expect(parsed.patch?.due).toBeNull();
    expect(parsed.patch?.meta).toEqual({ nested: true, n: 0 });
  });

  it('accepts the params-only form (the dialog collects the values) and the both form (patch under params)', () => {
    const paramsOnly = ActionSchema.safeParse({
      name: 'set_status', label: 'Set status', operation: 'update',
      params: [{ name: 'status', label: 'Status', type: 'select' as const, options: [{ label: 'Done', value: 'done' }] }],
    });
    expect(paramsOnly.success, JSON.stringify(paramsOnly)).toBe(true);
    const both = ActionSchema.safeParse({ ...duly, params: [{ name: 'note', type: 'text' as const }] });
    expect(both.success, JSON.stringify(both)).toBe(true);
  });

  it('is typed on `defineAction`\'s authoring input', () => {
    // Compile-time half of the accept pin: the literal must be assignable to
    // `z.input<typeof ActionSchema>` with the two new keys.
    const parsed = defineAction({ ...duly, objectName: 'duly_task' });
    expect(parsed.operation).toBe('update');
  });

  it('positive control — the api and script forms are untouched by the new refinements', () => {
    expect(ActionSchema.safeParse({
      name: 'revoke', label: 'Revoke', type: 'api', target: '/api/v1/sys_api_key/{id}',
      method: 'PATCH', bodyExtra: { revoked: true }, recordIdParam: 'id',
    }).success).toBe(true);
    expect(ActionSchema.safeParse({ name: 'run', label: 'Run', target: 'runThing' }).success).toBe(true);
  });
});

describe('#14092 — key shape: a parallel key beside `type`, not an `ActionType` member', () => {
  it('leaves the ActionType vocabulary exactly as it was', () => {
    // objectui types its dispatch table `Record<RunnableActionType, …>` so a
    // member added here stops the console compiling until it has an executor —
    // a coupling the contract-first split must not carry. The write rides the
    // existing `script` route instead.
    expect([...ActionType.options]).toEqual(['script', 'url', 'modal', 'flow', 'api', 'form']);
  });

  it('refuses `type: \'update\'` with the prescription, not zod\'s bare enum list', () => {
    const result = ActionSchema.safeParse({ name: 'x', label: 'X', type: 'update', patch: { status: 'done' } });
    const issue = issueAt(result, 'type');
    expect(issue?.code).toBe('invalid_value');
    expect(issue?.message).toMatch(/^`type: 'update'` is not an action type — the declarative single-record field write is spelled `operation: 'update'`/);
  });

  it('accepts an explicit `type: \'script\'` beside the operation — it is the route, and indistinguishable from the default', () => {
    const result = ActionSchema.safeParse({ ...duly, type: 'script' });
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it('refuses every OTHER explicit `type` beside `operation: \'update\'`, at `type`', () => {
    for (const type of ['url', 'modal', 'flow', 'api', 'form'] as const) {
      const result = ActionSchema.safeParse({ ...duly, type, target: '/somewhere' });
      const issue = issueAt(result, 'type');
      expect(issue?.code, `type '${type}'`).toBe('custom');
      expect(issue?.message, `type '${type}'`).toMatch(
        /^`operation: 'update'` is performed by the platform action route — the route a `type: 'script'` action posts to — so `type` stays at its default `'script'`; leave it off\./,
      );
      expect(issue?.message).toContain(`\`type: '${type}'\``);
    }
  });

  it('renames the bulk def\'s `op` shorthand and the near-misses of `patch` onto the canonical keys', () => {
    const op = ActionSchema.safeParse({ name: 'x', label: 'X', op: 'update', patch: { status: 'done' } });
    expect(op.success).toBe(false);
    expect(op.success ? '' : op.error.issues.map((i) => i.message).join('\n')).toContain('`op` → `operation`');
    for (const spelling of ['values', 'set', 'update']) {
      const result = ActionSchema.safeParse({ name: 'x', label: 'X', operation: 'update', [spelling]: { status: 'done' } });
      expect(result.success, spelling).toBe(false);
      expect(result.success ? '' : result.error.issues.map((i) => i.message).join('\n'), spelling)
        .toContain(`\`${spelling}\` → \`patch\``);
    }
  });
});

describe('#14092 — mixing rule: one refusal per contradiction, at the contradicting key', () => {
  const refused: ReadonlyArray<readonly [key: string, value: unknown, opening: RegExp]> = [
    ['target', 'doThing', /^`target` names a handler, URL, page, flow or endpoint — an `operation: 'update'` action dispatches on none of them/],
    ['body', { language: 'js', source: 'return 1;', capabilities: [] }, /^`body` is the inline handler of a `type: 'script'` action — an `operation: 'update'` action has no handler/],
    ['method', 'PATCH', /^`method` is the HTTP verb of a `type: 'api'` request — an `operation: 'update'` action makes no request of its own/],
    ['bodyExtra', { status: 'done' }, /^`bodyExtra` is the static request body of a `type: 'api'` action — on an `operation: 'update'` action the static field values go in `patch`/],
    ['bodyShape', { wrap: 'data' }, /^`bodyShape` shapes a `type: 'api'` request body — an `operation: 'update'` action sends no request body of its own/],
    ['recordIdParam', 'id', /^`recordIdParam` injects the row id into a request body — an `operation: 'update'` action binds the current record from the invocation context/],
    ['recordIdField', 'token', /^`recordIdField` seeds `recordIdParam` — an `operation: 'update'` action binds the current record from the invocation context/],
    ['onSuccess', { navigate: '/tasks' }, /^`onSuccess` is not defined for an `operation: 'update'` action yet/],
    ['opensInNewTab', true, /^`opensInNewTab` pre-opens a tab for a handler-returned `\{ redirectUrl \}` — an `operation: 'update'` action has no handler/],
    ['newTabUrl', '/open/{recordId}', /^`newTabUrl` is the zero-roundtrip target of the pre-opened-tab flow — an `operation: 'update'` action has no such flow/],
  ];

  for (const [key, value, opening] of refused) {
    it(`refuses \`${key}\` beside \`operation: 'update'\` at \`${key}\`, naming the executor it belongs to`, () => {
      // `newTabUrl` is only legal with `opensInNewTab: true` (#11842); pair
      // them so the issue under test is THIS rule's, not that one's.
      const extra = key === 'newTabUrl' ? { opensInNewTab: true } : {};
      const result = ActionSchema.safeParse({ ...duly, ...extra, [key]: value });
      const issue = issueAt(result, key);
      expect(issue?.code).toBe('custom');
      expect(issue?.message).toMatch(opening);
    });
  }

  it('refuses `patch` on an action WITHOUT `operation: \'update\'` — it would be silently dropped', () => {
    for (const base of [
      { name: 'x', label: 'X', target: 'doThing' },
      { name: 'x', label: 'X', type: 'api', target: '/api/x' },
    ]) {
      const result = ActionSchema.safeParse({ ...base, patch: { status: 'done' } });
      const issue = issueAt(result, 'patch');
      expect(issue?.code).toBe('custom');
      expect(issue?.message).toMatch(/^`patch` only applies to `operation: 'update'` — without it the action never writes fields, so these values would be silently dropped\./);
    }
  });

  it('refuses `operation: \'update\'` with neither `patch` nor `params` — nothing to write (empty params included)', () => {
    for (const shape of [
      { name: 'x', label: 'X', operation: 'update' },
      { name: 'x', label: 'X', operation: 'update', params: [] },
    ]) {
      const result = ActionSchema.safeParse(shape);
      const issue = issueAt(result, 'patch');
      expect(issue?.code).toBe('custom');
      expect(issue?.message).toMatch(/^An `operation: 'update'` action has nothing to write: declare a static `patch`/);
      // And the script-executability rule does NOT fire for it — the carve-out
      // is what keeps `body`-less, `target`-less the LEGAL shape here.
      expect(issueAt(result, 'body')).toBeUndefined();
    }
  });

  it('refuses a `list_toolbar` location — no current record there; the selection bar is the bulk def\'s home', () => {
    const result = ActionSchema.safeParse({ ...duly, locations: ['record_header', 'list_toolbar'] });
    const issue = issueAt(result, 'locations.1');
    expect(issue?.code).toBe('custom');
    expect(issue?.message).toMatch(/^`list_toolbar` has no current record — an `operation: 'update'` action writes ONE record, the one it runs on\./);
    expect(issueAt(result, 'locations.0')).toBeUndefined();
    expect(ActionSchema.safeParse({ ...duly, locations: ['list_item', 'record_header', 'record_more', 'record_section'] }).success).toBe(true);
  });

  it('refuses the bulk-only operations with the reason, not a bare enum list', () => {
    const del = issueAt(ActionSchema.safeParse({ ...duly, operation: 'delete', patch: undefined }), 'operation');
    expect(del?.code).toBe('invalid_value');
    expect(del?.message).toMatch(/^`operation: 'delete'` is a bulk-def operation with no row-level form: a row delete is the object's own delete affordance/);
    const custom = issueAt(ActionSchema.safeParse({ ...duly, operation: 'custom' }), 'operation');
    expect(custom?.code).toBe('invalid_value');
    expect(custom?.message).toMatch(/^`operation: 'custom'` is a bulk-def operation with no row-level form: on a bulk def `'custom'` dispatches the action the def NAMES/);
  });

  it('composes with the #7428 pair rule — `confirmText` beside a non-empty `params` is still one dialog too many', () => {
    const result = ActionSchema.safeParse({ ...duly, confirmText: 'Sure?', params: [{ name: 'note', type: 'text' as const }] });
    expect(issueAt(result, 'confirmText')?.code).toBe('custom');
    // and nothing ELSE fires — the update itself is well-formed.
    expect(paths(result)).toEqual(['confirmText']);
  });
});

describe('#14092 — boundaries', () => {
  it('an inline page-element action cannot carry the keys at all (registered-action form only)', () => {
    const result = InlineActionSchema.safeParse({ operation: 'update', patch: { status: 'done' } });
    expect(result.success).toBe(false);
    const message = result.success ? '' : result.error.issues.map((i) => i.message).join('\n');
    expect(message).toContain('operation');
    expect(message).toContain('patch');
  });

  it('defineStack refuses a STANDALONE update action that names no objectName — a global action has no record', () => {
    const lines = stackRefusals({ manifest, objects: [taskObject], actions: [duly] });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Action 'duly_task_complete' (stack.actions[0]) is `operation: 'update'`");
    expect(lines[0]).toContain('declares no `objectName`');
    expect(lines[0]).toContain("Set `objectName: 'the_object'`");
    // Whether or not the stack declares any objects: the refusal runs before
    // the object-count early return, like the duplicate-key check beside it.
    expect(stackRefusals({ manifest, actions: [duly] })).toHaveLength(1);
  });

  it('defineStack builds the standalone form with objectName (merged into the object) and the embedded form', () => {
    const standalone = defineStack({ manifest, objects: [taskObject], actions: [{ ...duly, objectName: 'duly_task' }] });
    expect(standalone.objects?.[0]?.actions?.[0]).toMatchObject({ name: 'duly_task_complete', operation: 'update', patch: { status: 'done' } });
    const embedded = defineStack({ manifest, objects: [{ ...taskObject, actions: [duly] }] });
    expect(embedded.objects?.[0]?.actions?.[0]).toMatchObject({ operation: 'update', patch: { status: 'done' } });
  });

  it('leaves the bulk def\'s own vocabulary untouched — mirrored, not moved', () => {
    expect(BulkActionDefSchema.safeParse({ name: 'bulk_done', operation: 'update', patch: { status: 'done' } }).success).toBe(true);
    expect(BulkActionDefSchema.safeParse({ name: 'bulk_gone', operation: 'delete' }).success).toBe(true);
    expect(BulkActionDefSchema.safeParse({ name: 'bulk_recalc', operation: 'custom', execution: 'aggregate' }).success).toBe(true);
  });
});

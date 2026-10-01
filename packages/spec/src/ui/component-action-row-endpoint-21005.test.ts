// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #21005 — `action:button` / `action:icon` refuse `endpoint` with the rename
// `ActionSchema` gives, read from ONE table (`action-target-aliases.ts`).
//
// Before: the two `ComponentPropsMap` rows declared `endpoint` while
// `ActionSchema` refused it with "Did you mean `endpoint` → `target`?" — one
// concept, two verdicts in one release — and the console's `api` handler reads
// `target` only, so an `api` button written with `endpoint` called nothing.
// What is pinned here is the refusal's ENVELOPE (`unrecognized_keys`, the key)
// and the prescription clause, compared between the row and the action rather
// than against a hand-copied string: the claim is that they are one message.

import { describe, expect, it } from 'vitest';
import { ActionSchema } from './action.zod';
import { ACTION_TARGET_ALIASES } from './action-target-aliases';
import { ActionButtonPropsSchema, ActionIconPropsSchema, ComponentPropsMap } from './component.zod';

type Issue = { code: string; path: PropertyKey[]; message: string; keys?: string[] };

/** The one root-level `unrecognized_keys` issue of a failed parse. */
const unknownKeyIssue = (result: { success: boolean; error?: { issues: unknown[] } }): Issue => {
  expect(result.success).toBe(false);
  const at = (result.error!.issues as Issue[]).filter((i) => i.code === 'unrecognized_keys' && i.path.length === 0);
  expect(at).toHaveLength(1);
  return at[0]!;
};

/** The rename clause of an unknown-key message — `Did you mean `a` → `b`?`. */
const renameClause = (message: string): string | undefined => /Did you mean [^?]*\?/.exec(message)?.[0];

/** The prescription `ActionSchema` prints for `key` — the reference both rows must equal. */
const actionClause = (key: string): string | undefined =>
  renameClause(unknownKeyIssue(ActionSchema.safeParse({ name: 'go', label: 'Go', type: 'api', [key]: '/api/v1/x' })).message);

const ROWS = [
  ['action:button', ActionButtonPropsSchema, { label: 'Go' }],
  ['action:icon', ActionIconPropsSchema, { icon: 'play' }],
] as const;

describe('[#21005] the action rows refuse `endpoint` with ActionSchema\'s own rename', () => {
  it.each(ROWS)('`%s` refuses `endpoint` — the same `endpoint` → `target` clause ActionSchema prints', (type, schema, rest) => {
    const issue = unknownKeyIssue(schema.safeParse({ ...rest, actionType: 'api', endpoint: '/api/v1/x' }));
    expect(issue.keys).toEqual(['endpoint']);
    expect(issue.message).toContain(`\`${type}\``);
    const clause = renameClause(issue.message);
    expect(clause).toContain('`endpoint` → `target`');
    expect(clause).toBe(actionClause('endpoint'));
  });

  it.each(ROWS)('control: `%s` parses the same value written as `target`', (_type, schema, rest) => {
    const authored = { ...rest, actionType: 'api', target: '/api/v1/x' };
    expect(schema.parse(authored)).toEqual(authored);
  });

  it('`endpoint` is no longer a declared key of either row (the props-map entries are the exported schemas)', () => {
    for (const [type, schema] of ROWS) {
      expect((ComponentPropsMap as Record<string, unknown>)[type]).toBe(schema);
      expect(Object.keys((schema as unknown as { shape: Record<string, unknown> }).shape), type).not.toContain('endpoint');
    }
  });

  it('one table: every executor-target alias renames identically on the action and on both rows', () => {
    // `path` is the one the rows used to get WRONG on their own: the
    // edit-distance fallback answered `patch` — the declarative write's field
    // values, `z.unknown()`, which parses.
    expect(Object.keys(ACTION_TARGET_ALIASES).sort()).toEqual(['endpoint', 'href', 'path', 'url']);
    for (const key of Object.keys(ACTION_TARGET_ALIASES)) {
      const expected = actionClause(key);
      expect(expected, key).toContain(`\`${key}\` → \`target\``);
      for (const [type, schema, rest] of ROWS) {
        const issue = unknownKeyIssue(schema.safeParse({ ...rest, [key]: '/api/v1/x' }));
        expect(issue.keys, `${type}.${key}`).toEqual([key]);
        expect(renameClause(issue.message), `${type}.${key}`).toBe(expected);
      }
    }
  });
});

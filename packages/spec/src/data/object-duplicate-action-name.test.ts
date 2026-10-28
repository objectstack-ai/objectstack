// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #26725 — an object's `actions` array declares each action name once.
 *
 * Measured on `main` @ `c8583f80` before this rule, on a `pnpm dev:crm` boot:
 * `PUT /api/v1/meta/object/dup_item?mode=draft` with two actions named `dup`
 * answered 200, the publish answered 200, and the served object listed both
 * (`dup/Dup A`, `dup/Dup B`). `defineStack` already refused the pair for a
 * stack; the object parse now refuses it for every door that parses an object.
 *
 * Each refusal fixture differs from an accepted twin by one name.
 */
import { describe, expect, it } from 'vitest';
import { ObjectSchema } from './object.zod';
import { duplicateActionNames } from './duplicate-action-names';

const act = (name: string, label = name) => ({ name, label, type: 'script' as const, target: 'noop' });

const objectWith = (actions: unknown[]) => ({
  name: 'probe_item',
  label: 'Probe Item',
  fields: { title: { type: 'text' as const, label: 'Title' } },
  actions,
});

const issuesAtActions = (row: unknown) => {
  const parsed = ObjectSchema.safeParse(row);
  return parsed.success ? [] : parsed.error.issues.filter((i) => i.path[0] === 'actions');
};

describe('#26725 the object parse refuses two actions under one name', () => {
  it('refuses a pair, at the second declaration, naming the name and both indexes', () => {
    const issues = issuesAtActions(objectWith([act('dup', 'Dup A'), act('dup', 'Dup B')]));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('custom');
    expect(issues[0]!.path).toEqual(['actions', 1]);
    expect(issues[0]!.message.startsWith(
      "Object 'probe_item' declares the action 'dup' twice in actions: actions[0] and actions[1].",
    )).toBe(true);
  });

  it('control: the same object with distinct names parses', () => {
    expect(ObjectSchema.safeParse(objectWith([act('dup', 'Dup A'), act('dup_b', 'Dup B')])).success).toBe(true);
  });

  it('counts three declarations as one issue listing every index, at the second one', () => {
    const issues = issuesAtActions(objectWith([act('first_one'), act('dup'), act('second_one'), act('dup'), act('dup')]));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(['actions', 3]);
    expect(issues[0]!.message.startsWith(
      "Object 'probe_item' declares the action 'dup' 3 times in actions: actions[1], actions[3] and actions[4].",
    )).toBe(true);
  });

  it('reports one issue per repeated name', () => {
    const issues = issuesAtActions(objectWith([act('dup_x'), act('dup_y'), act('dup_x'), act('dup_y')]));
    expect(issues.map((i) => i.path)).toEqual([['actions', 2], ['actions', 3]]);
  });

  it('refuses a byte-identical twin too: two entries are two declarations under one key', () => {
    const twin = act('same');
    expect(issuesAtActions(objectWith([twin, { ...twin }]))).toHaveLength(1);
  });
});

describe('#26725 duplicateActionNames reads a stored body as the parse does', () => {
  it('leaves a non-array, a non-object entry and a nameless entry to the schema', () => {
    expect(duplicateActionNames('o', undefined)).toEqual([]);
    expect(duplicateActionNames('o', { dup: {} })).toEqual([]);
    expect(duplicateActionNames('o', [null, 'dup', { label: 'x' }, { label: 'y' }, { name: '' }, { name: '' }])).toEqual([]);
  });

  it('names the object when it has a name, and says "This object" when it has none', () => {
    expect(duplicateActionNames(undefined, [act('d'), act('d')])[0]!.message.startsWith(
      "This object declares the action 'd' twice",
    )).toBe(true);
  });
});

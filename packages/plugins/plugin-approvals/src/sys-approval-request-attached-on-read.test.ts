// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22211 ruling A, #22387] `sys_approval_request`'s own action predicates pass
 * the shared validator, because the object declares the block they read.
 *
 * Eight shipped `visible` predicates gate on `record.viewer.*` — the per-caller
 * block `ApprovalService.attachViewers` sets on every row it serves (#3310).
 * Until the object declared that block under `attachedOnRead`, the validator
 * `os build` / `os validate` run refused all eight as naming an unknown field,
 * and so did the object save door once it judged action predicates.
 *
 * The object is judged here the way those commands judge it: the stack is
 * normalized and parsed (`normalizeStackInput`, `ObjectStackDefinitionSchema`),
 * then read by `validateStackExpressions` and `runAuthoringRules('build')`;
 * the save door is `runRuntimeAuthoringRules({ type: 'object' })`. The rule
 * under test is the expression rule (`expression-invalid`); the object's other
 * build findings are not this file's question.
 *
 * Every assertion reads the object's own predicates and its own declaration —
 * no predicate or leaf list is copied here. Two controls keep the green honest:
 * the same call refuses a misspelt leaf, naming the leaves the object declares,
 * and refuses every `viewer` read once the declaration is taken away.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackDefinitionSchema, normalizeStackInput } from '@objectstack/spec';
import {
  EXPRESSION_INVALID,
  runAuthoringRules,
  runRuntimeAuthoringRules,
  validateStackExpressions,
} from '@objectstack/lint';
import { SysApprovalRequest } from './sys-approval-request.object.js';

const MANIFEST = {
  id: 'com.objectstack.test.approvals-attached-on-read',
  name: 'approvals_attached_on_read',
  version: '1.0.0',
  type: 'app',
} as const;

type Action = { name: string; visible?: unknown };

/** An action predicate's source text — `ObjectSchema.create` stores the CEL envelope. */
const sourceOf = (visible: unknown): string =>
  typeof visible === 'string' ? visible : String((visible as { source?: unknown } | undefined)?.source ?? '');

const ACTIONS = ((SysApprovalRequest as { actions?: Action[] }).actions ?? []);
/** The shipped predicates that read the block: the population this file judges. */
const VIEWER_READERS = ACTIONS.filter((a) => sourceOf(a.visible).includes('record.viewer.'));
const DECLARED_LEAVES = Object.keys(SysApprovalRequest.attachedOnRead?.viewer ?? {});

const whereOf = (action: string) => `object 'sys_approval_request' · action '${action}' visible`;

/** The object, judged by the build pair and by the object save door. */
function judge(object: Record<string, unknown>) {
  const normalized = normalizeStackInput({ manifest: MANIFEST, objects: [object] }) as Record<string, unknown>;
  const result = ObjectStackDefinitionSchema.safeParse(normalized);
  if (!result.success) {
    throw new Error(
      'fixture is not spec-valid: '
        + result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    );
  }
  const parsed = result.data as Record<string, unknown>;
  return {
    expressions: validateStackExpressions(parsed),
    build: runAuthoringRules('build', { normalized, parsed }).filter((f) => f.rule === EXPRESSION_INVALID),
    door: runRuntimeAuthoringRules({ type: 'object', item: object }).errors.filter((f) => f.rule === EXPRESSION_INVALID),
  };
}

/** The object with one action's predicate rewritten. */
function withPredicate(action: string, rewrite: (source: string) => string): Record<string, unknown> {
  return {
    ...SysApprovalRequest,
    actions: ACTIONS.map((a) => (a.name === action ? { ...a, visible: rewrite(sourceOf(a.visible)) } : a)),
  };
}

describe('sys_approval_request — its action predicates against its attachedOnRead declaration', () => {
  it('the population: shipped predicates read the block, and the object declares its leaves', () => {
    expect(VIEWER_READERS.length).toBeGreaterThan(0);
    expect(DECLARED_LEAVES.length).toBeGreaterThan(0);
  });

  it('every predicate passes the build pair and the object save door', () => {
    const { expressions, build, door } = judge(SysApprovalRequest as Record<string, unknown>);
    expect(expressions, JSON.stringify(expressions, null, 2)).toEqual([]);
    expect(build, JSON.stringify(build, null, 2)).toEqual([]);
    expect(door, JSON.stringify(door, null, 2)).toEqual([]);
  });

  it('a misspelt leaf is still refused at all three, naming the leaves the object declares', () => {
    const target = VIEWER_READERS[0].name;
    const leaf = DECLARED_LEAVES[0];
    const misspelt = `${leaf}_x`;
    const { expressions, build, door } = judge(
      withPredicate(target, (s) => s.replaceAll(`record.viewer.${leaf}`, `record.viewer.${misspelt}`)),
    );
    for (const [surface, found] of [['validateStackExpressions', expressions], ['build', build], ['door', door]] as const) {
      expect(found, `${surface}: one refusal`).toHaveLength(1);
      const [issue] = found as Array<{ message: string; where?: string; path?: string; severity?: string }>;
      expect(issue.severity ?? 'error', surface).toBe('error');
      // The subject is the misspelt path, and the remedy names every declared leaf.
      expect(issue.message, surface).toContain(`viewer.${misspelt}`);
      for (const declared of DECLARED_LEAVES) expect(issue.message, `${surface} names \`${declared}\``).toContain(`\`${declared}\``);
    }
    expect(expressions[0].where).toBe(whereOf(target));
    expect(build[0].where).toBe(whereOf(target));
  });

  it('control: without the declaration, every predicate that reads the block is refused again', () => {
    const undeclared = Object.fromEntries(
      Object.entries(SysApprovalRequest).filter(([key]) => key !== 'attachedOnRead'),
    );
    const { expressions, build, door } = judge(undeclared);
    const readers = VIEWER_READERS.map((a) => whereOf(a.name)).sort();
    expect(expressions.map((i) => i.where).sort()).toEqual(readers);
    expect(build.map((f) => f.where).sort()).toEqual(readers);
    expect(door).toHaveLength(VIEWER_READERS.length);
    for (const issue of [...expressions, ...build, ...door]) expect(issue.message).toContain('`viewer`');
  });
});

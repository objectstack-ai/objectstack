// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27166] The QueryAST's own `fields` (and so every nested `expand` value)
 * and the flow `get_record` node's `fields` take the projection's array arm
 * the other published declarations take: at least one name, none blank. The
 * in-process engine refuses an empty projection at its `find` / `findOne`
 * entry, top level and at any `expand` depth (#27008), and the `get_record`
 * executor hands its authored `fields` to that entry as written, so a
 * declaration admitting `[]` admitted a shape the runtime refuses.
 *
 * Every refusal is pinned against the sentence `EngineQueryOptionsSchema.fields`
 * gives for the same value, so the declarations cannot drift apart.
 */

import { describe, it, expect } from 'vitest';
import { QuerySchema } from './query.zod';
import { EngineQueryOptionsSchema, QueryTransportParamsSchema, QueryWithTransportSchema } from './data-engine.zod';
import { GetRecordConfigSchema } from '../automation/builtin-node-config.zod';
import { flowNodeConfigRefusals } from '../automation/flow-node-config-refusals';
import { defineStack } from '../stack.zod';

type Path = ReadonlyArray<string | number>;

const REFUSED: ReadonlyArray<readonly [string, string[], Path]> = [
  ['an empty list', [], []],
  ['a list with a blank name', ['name', ''], [1]],
  ['a list with a whitespace name', ['name', '  '], [1]],
];
const KEPT: ReadonlyArray<readonly [string, string[]]> = [
  ['one name', ['name']],
  ['two names', ['name', 'email']],
];

/** The first issue a schema raises for `input`, or a failed expectation when it parses. */
function firstIssue(schema: { safeParse(v: unknown): { success: boolean; error?: { issues: Array<{ message: string; path: PropertyKey[] }> } } }, input: unknown) {
  const parsed = schema.safeParse(input);
  expect(parsed.success, `refuses ${JSON.stringify(input)}`).toBe(false);
  return parsed.error!.issues[0]!;
}

/** The sentence the engine-side declaration gives for the same projection value. */
const engineMessage = (value: string[]) => firstIssue(EngineQueryOptionsSchema, { fields: value }).message;

describe('QuerySchema.fields admits exactly what EngineQueryOptionsSchema.fields admits', () => {
  it.each(REFUSED)('refuses %s at the top level, in the engine declaration\'s words', (_name, value, tail) => {
    const issue = firstIssue(QuerySchema, { object: 'task', fields: value });
    expect(issue.path).toEqual(['fields', ...tail]);
    expect(issue.message).toBe(engineMessage(value));
  });

  it.each(REFUSED)('refuses %s on an expand entry, naming the entry', (_name, value, tail) => {
    const issue = firstIssue(QuerySchema, { object: 'task', fields: ['title', 'project_id'], expand: { project_id: { object: 'project', fields: value } } });
    expect(issue.path).toEqual(['expand', 'project_id', 'fields', ...tail]);
    expect(issue.message).toBe(engineMessage(value));
  });

  it.each(REFUSED)('refuses %s on a second-level expand entry', (_name, value, tail) => {
    const query = {
      object: 'task',
      expand: { project_id: { object: 'project', expand: { org_id: { object: 'org', fields: value } } } },
    };
    const issue = firstIssue(QuerySchema, query);
    expect(issue.path).toEqual(['expand', 'project_id', 'expand', 'org_id', 'fields', ...tail]);
    expect(issue.message).toBe(engineMessage(value));
  });

  it.each(REFUSED)('EngineQueryOptionsSchema.expand refuses %s on an entry, as the engine entry does', (_name, value, tail) => {
    const issue = firstIssue(EngineQueryOptionsSchema, { expand: { project_id: { object: 'project', fields: value } } });
    expect(issue.path).toEqual(['expand', 'project_id', 'fields', ...tail]);
    expect(issue.message).toBe(engineMessage(value));
  });

  it.each(REFUSED)('the transport-aware query slot refuses canonical `fields` %s as it refuses `$select`', (_name, value, tail) => {
    const issue = firstIssue(QueryWithTransportSchema, { object: 'task', fields: value });
    expect(issue.path).toEqual(['fields', ...tail]);
    expect(issue.message).toBe(firstIssue(QueryTransportParamsSchema, { $select: value }).message);
  });

  it.each(KEPT)('keeps %s unchanged, at the top level and on an expand entry', (_name, value) => {
    const query = { object: 'task', fields: value, expand: { project_id: { object: 'project', fields: value } } };
    const parsed = QuerySchema.parse(query);
    expect(parsed.fields).toEqual(value);
    expect(parsed.expand?.project_id?.fields).toEqual(value);
  });

  it('keeps an absent projection: absent still reads every column', () => {
    const parsed = QuerySchema.parse({ object: 'task', expand: { project_id: { object: 'project' } } });
    expect(parsed.fields).toBeUndefined();
    expect(parsed.expand?.project_id?.fields).toBeUndefined();
  });
});

describe('GetRecordConfigSchema.fields: an empty projection is refused at save, not at run', () => {
  const config = (fields: unknown) => ({ objectName: 'gr_task', filter: { title: 'alpha' }, fields });

  it.each(REFUSED)('refuses %s, in the engine declaration\'s words', (_name, value, tail) => {
    const issue = firstIssue(GetRecordConfigSchema, config(value));
    expect(issue.path).toEqual(['fields', ...tail]);
    expect(issue.message).toBe(engineMessage(value));
  });

  it.each(REFUSED)('the save door\'s node judge refuses %s at `fields`, naming the blank member', (_name, value, tail) => {
    const at = `fields${tail.map((i) => `[${i}]`).join('')}`;
    expect(flowNodeConfigRefusals('get_record', config(value)).map(({ code, params, path }) => ({ code, params, path }))).toEqual([
      { code: 'node-config-refused-by-contract', params: { nodeType: 'get_record', key: at }, path: at },
    ]);
  });

  it('defineStack refuses a get_record node with `fields: []` at its config path', () => {
    const stack = {
      manifest: { id: 'com.example.projection', name: 'projection', version: '1.0.0', type: 'app', namespace: 'gr' },
      objects: [{ name: 'gr_task', label: 'Task', fields: { title: { type: 'text', label: 'Title' } } }],
      flows: [{
        name: 'gr_read',
        label: 'Read',
        type: 'autolaunched',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'read', type: 'get_record', label: 'Read', config: config([]) },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'read' },
          { id: 'e2', source: 'read', target: 'end' },
        ],
      }],
    };
    let refusal: { code?: unknown; status?: unknown; issues?: Array<{ path: unknown[] }> } | undefined;
    try {
      defineStack(stack as never);
    } catch (e) {
      refusal = e as typeof refusal;
    }
    expect(refusal, 'defineStack must refuse the flow').toBeDefined();
    expect({ code: refusal!.code, status: refusal!.status }).toEqual({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    expect(refusal!.issues!.map((i) => i.path.join('.'))).toEqual(['flows.0.nodes.1.config.fields']);
  });

  it.each(KEPT)('keeps %s unchanged, and the node judge finds nothing', (_name, value) => {
    expect(GetRecordConfigSchema.parse(config(value)).fields).toEqual(value);
    expect(flowNodeConfigRefusals('get_record', config(value))).toEqual([]);
  });

  it('keeps an absent projection: the node reads every field', () => {
    expect(GetRecordConfigSchema.parse({ objectName: 'gr_task' }).fields).toBeUndefined();
    expect(flowNodeConfigRefusals('get_record', { objectName: 'gr_task' })).toEqual([]);
  });
});

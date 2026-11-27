// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { validateSeedRecordKeys, SEED_RECORD_UNKNOWN_FIELD } from './validate-seed-record-keys.js';
import { AUTHORING_RULES } from './authoring-rules.js';

const entry = AUTHORING_RULES.find((r) => r.name === 'validateSeedRecordKeys')!;
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';

const TASK = {
  name: 'pr_task',
  label: 'Task',
  sharingModel: 'private',
  fields: { name: { type: 'text', label: 'Name' }, done: { type: 'boolean', label: 'Done' } },
};

const seed = (records: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({
  object: 'pr_task',
  externalId: 'name',
  records,
  ...extra,
});

describe('validateSeedRecordKeys (#35143)', () => {
  it('refuses a record key that is not a field of the object, naming the near miss', () => {
    const findings = validateSeedRecordKeys({ objects: [TASK], data: [seed([{ name: 'a', dnoe: true }])] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: SEED_RECORD_UNKNOWN_FIELD,
      path: 'data[0].records[0].dnoe',
      where: 'seed "pr_task" · records[0]',
    });
    expect(findings[0].message).toContain('"dnoe" is not a field of "pr_task"');
    expect(findings[0].hint).toContain('"done"');
  });

  it('reports a key once per dataset, at the first record that carries it', () => {
    const findings = validateSeedRecordKeys({
      objects: [TASK],
      data: [seed([{ name: 'a' }, { name: 'b', bogus: 1 }, { name: 'c', bogus: 2 }])],
    });
    expect(findings.map((f) => f.path)).toEqual(['data[0].records[1].bogus']);
  });

  it('refuses a `columns` key that names no column', () => {
    const findings = validateSeedRecordKeys({
      objects: [TASK],
      data: [seed([{ name: 'a' }], { columns: { stauts: { applyOn: 'create' } } })],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('data[0].columns.stauts');
    expect(findings[0].message).toContain('governs nothing');
  });

  it('accepts declared fields and the system columns injected on the object', () => {
    expect(
      validateSeedRecordKeys({
        objects: [TASK],
        data: [seed([{ name: 'a', done: true, created_at: '2026-01-01T00:00:00Z', owner_id: 'u1' }], {
          columns: { done: { applyOn: 'create' } },
        })],
      }),
    ).toEqual([]);
  });

  it('refuses an injected column the object opts out of, as defineSeed does', () => {
    const findings = validateSeedRecordKeys({
      objects: [{ ...TASK, systemFields: false }],
      data: [seed([{ name: 'a', created_at: '2026-01-01T00:00:00Z' }])],
    });
    expect(findings.map((f) => f.path)).toEqual(['data[0].records[0].created_at']);
  });

  it('judges no dataset whose object the snapshot does not hold', () => {
    expect(
      validateSeedRecordKeys({ objects: [TASK], data: [{ object: 'crm_other', externalId: 'name', records: [{ x: 1 }] }] }),
    ).toEqual([]);
  });

  it('reads a field an object extension adds (served objects)', () => {
    const stack = {
      objects: [TASK],
      objectExtensions: [{ extend: 'pr_task', fields: { priority: { type: 'text', label: 'Priority' } } }],
      data: [seed([{ name: 'a', priority: 'high' }])],
    };
    expect(entry.run(stack, {})).toEqual([]);
    // Control: the same key without the extension is refused by the registry entry.
    expect(
      entry.run({ objects: [TASK], data: [seed([{ name: 'a', priority: 'high' }])] }, {}).map((f) => [f.rule, f.path]),
    ).toEqual([[SEED_RECORD_UNKNOWN_FIELD, 'data[0].records[0].priority']]);
  });
});

describe('validateSeedRecordKeys at the runtime `seed` publish door (#35143)', () => {
  it('is dispatched for seed writes', () => {
    expect(runtimeAuthoringRulesFor('seed').map((r) => r.name)).toContain('validateSeedRecordKeys');
  });

  it('refuses a seed write whose record carries a key the served object does not have', () => {
    const result = runRuntimeAuthoringRules({
      type: 'seed',
      name: 'pr_task_seed',
      item: seed([{ name: 'a', bogus_key: 1 }]),
      context: { objects: [TASK] },
    });
    expect(result.errors.map((e) => [e.rule, e.severity, e.path])).toEqual([
      [SEED_RECORD_UNKNOWN_FIELD, 'error', 'data[0].records[0].bogus_key'],
    ]);
  });

  it('passes the same write once the key is a field', () => {
    const result = runRuntimeAuthoringRules({
      type: 'seed',
      name: 'pr_task_seed',
      item: seed([{ name: 'a', done: true }]),
      context: { objects: [TASK] },
    });
    expect(result.errors).toEqual([]);
    expect(result.rulesRun).toContain('validateSeedRecordKeys');
  });
});

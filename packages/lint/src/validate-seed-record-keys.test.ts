// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { explainRule } from './rule-explanations.js';

import { validateSeedRecordKeys } from './validate-seed-record-keys.js';
import { AUTHORING_RULES } from './authoring-rules.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';

import { SEED_RECORD_UNKNOWN_FIELD } from './validate-seed-record-keys.js';
const HERE = dirname(fileURLToPath(import.meta.url));
const entry = AUTHORING_RULES.find((r) => r.name === 'validateSeedRecordKeys')!;

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
    expect(findings[0].hint).toContain("'done'");
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

  it('admits the columns the engine provisions on every table even when the object opts out of system columns', () => {
    // The engine's insert door accepts `PLATFORM_PROVISIONED_COLUMNS` undeclared
    // on every object; read the list from its source so the two cannot drift.
    const source = readFileSync(resolve(HERE, '../../objectql/src/declared-read-columns.ts'), 'utf8');
    const listed = /export const PLATFORM_PROVISIONED_COLUMNS = \[([^\]]*)\]/.exec(source)?.[1] ?? '';
    const provisioned = [...listed.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(provisioned).toEqual(['id', 'created_at', 'updated_at']);

    const record = Object.fromEntries([['name', 'a'], ...provisioned.map((c) => [c, 'x'])]);
    expect(validateSeedRecordKeys({ objects: [{ ...TASK, systemFields: false }], data: [seed([record])] })).toEqual([]);
    // Control: an injected column the object opts out of and the engine does
    // not provision is still refused — the engine's door refuses it too.
    const refused = validateSeedRecordKeys({
      objects: [{ ...TASK, systemFields: false }],
      data: [seed([{ name: 'a', created_by: 'u1' }])],
    });
    expect(refused.map((f) => f.path)).toEqual(['data[0].records[0].created_by']);
  });

  it('judges no object whose field map is empty, as the engine\'s door has no opinion on one', () => {
    expect(
      validateSeedRecordKeys({ objects: [{ ...TASK, fields: {} }], data: [seed([{ name: 'a', anything: 1 }])] }),
    ).toEqual([]);
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
      item: seed([{ name: 'a', done: true }]),
      context: { objects: [TASK] },
    });
    expect(result.errors).toEqual([]);
    expect(result.rulesRun).toContain('validateSeedRecordKeys');
  });
});

describe('`os explain seed-record-unknown-field` (#35143)', () => {
  it('has an entry that names the remedy', () => {
    const entry = explainRule('seed-record-unknown-field');
    expect(entry?.rule).toBe('seed-record-unknown-field');
    expect(entry?.paragraphs.join('\n')).toContain('`created_at`');
  });
});

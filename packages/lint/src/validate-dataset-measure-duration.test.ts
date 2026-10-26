// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#25778] `measure-duration-field-type-refused` — the authoring-time leg of the
// dataset duration measure (`duration: { from, to, unit }`). The dataset compile
// refuses a duration column not declared `datetime` with `400 DATASET_INVALID`;
// this leg refuses the same column where the author is standing. The negative
// controls matter as much as the refusals: a `datetime` pair, the registry's own
// `created_at`, and the skips (a name the object does not declare, an untyped
// field) must stay silent, and the duration measure must never reach the
// aggregate × field-type leg, which reads a `field` it does not have.
import { describe, expect, it } from 'vitest';
import { DatasetSchema, DATASET_DURATION_FIELD_TYPE } from '@objectstack/spec/ui';

import { runAuthoringRules } from './authoring-rules.js';
import { MEASURE_DURATION_FIELD_TYPE_REFUSED as BARREL_ID } from './index.js';
import { explainRule } from './rule-explanations.js';
import { DATASET_FIELD_UNKNOWN, validateDatasetReferences } from './validate-dataset-references.js';
import {
  MEASURE_AGGREGATE_FIELD_TYPE_REFUSED,
  MEASURE_DURATION_FIELD_TYPE_REFUSED,
  validateDatasetMeasureAggregates,
} from './validate-dataset-measure-aggregates.js';
import { FIELD_NO_CONSUMERS, validateFieldConsumers } from './validate-field-consumers.js';

const RULE = MEASURE_DURATION_FIELD_TYPE_REFUSED;

/** One object with a field of every class the leg distinguishes, and one dataset whose duration reads `from` → `to`. */
const stackWith = (from: unknown, to: unknown, extra: { fields?: Record<string, unknown> } = {}): Record<string, unknown> => ({
  name: 'duration_probe',
  objects: [
    {
      name: 'support_ticket',
      label: 'Ticket',
      sharingModel: 'private',
      fields: extra.fields ?? {
        subject: { type: 'text' },
        opened_at: { type: 'datetime' },
        resolved_at: { type: 'datetime' },
        due_on: { type: 'date' },
        cutoff: { type: 'time' },
        effort: { type: 'number' },
        untyped: { label: 'Untyped' },
      },
    },
  ],
  datasets: [
    {
      name: 'resolution',
      label: 'Resolution',
      object: 'support_ticket',
      dimensions: [{ name: 'subject', field: 'subject', type: 'string' }],
      measures: [{ name: 'avg_hours', aggregate: 'avg', duration: { from, to, unit: 'hours' } }],
    },
  ],
});

const findings = (stack: unknown) => validateDatasetMeasureAggregates(stack).filter((f) => f.rule === RULE);

describe('[#25778] measure-duration-field-type-refused — a duration column that holds no instant', () => {
  it.each([
    ['due_on', 'date'],
    ['cutoff', 'time'],
    ['effort', 'number'],
    ['subject', 'text'],
  ])('refuses `from` over %s (`%s`), naming the column, its type and the remedy', (column, type) => {
    const found = findings(stackWith(column, 'resolved_at'));
    expect(found).toEqual([
      {
        severity: 'error',
        rule: RULE,
        where: 'dataset "resolution" › measure "avg_hours"',
        path: 'datasets[0].measures[0].duration.from',
        message:
          `\`duration.from\` reads field "${column}" (\`${type}\` on object "support_ticket"), which holds no ` +
          'instant, so the dataset compile refuses it (400 DATASET_INVALID)',
        hint: 'Point `duration.from` at a `datetime` field of "support_ticket".',
      },
    ]);
  });

  it('one finding per refused column, `to` at its own path', () => {
    const found = findings(stackWith('due_on', 'effort'));
    expect(found.map((f) => f.path)).toEqual(['datasets[0].measures[0].duration.from', 'datasets[0].measures[0].duration.to']);
    expect(findings(stackWith('opened_at', 'cutoff')).map((f) => f.path)).toEqual(['datasets[0].measures[0].duration.to']);
  });

  it('accepts a `datetime` pair, and the registry\'s own `created_at` — the spec\'s one accepted type', () => {
    expect(DATASET_DURATION_FIELD_TYPE).toBe('datetime');
    expect(findings(stackWith('opened_at', 'resolved_at'))).toEqual([]);
    expect(findings(stackWith('created_at', 'resolved_at'))).toEqual([]);
  });

  it('stays silent on what it cannot judge: a name the object does not declare (dataset-field-unknown\'s), an untyped field', () => {
    expect(findings(stackWith('opend_at', 'resolved_at'))).toEqual([]);
    expect(findings(stackWith('untyped', 'resolved_at'))).toEqual([]);
    // …and the name that does not resolve is reported where it belongs.
    const unknown = validateDatasetReferences(stackWith('opend_at', 'resolved_at')).filter((f) => f.rule === DATASET_FIELD_UNKNOWN);
    expect(unknown.map((f) => f.path)).toEqual(['datasets[0].measures[0].duration.from']);
    expect(unknown[0].message).toContain('opend_at');
    expect(validateDatasetReferences(stackWith('opened_at', 'resolved_at')).filter((f) => f.rule === DATASET_FIELD_UNKNOWN)).toEqual([]);
  });

  it('a duration measure never reaches the aggregate × field-type leg', () => {
    const all = validateDatasetMeasureAggregates(stackWith('opened_at', 'resolved_at'));
    expect(all.filter((f) => f.rule === MEASURE_AGGREGATE_FIELD_TYPE_REFUSED)).toEqual([]);
  });

  it('the fixtures are documents the spec accepts — the leg judges types, not shapes', () => {
    for (const [from, to] of [['due_on', 'resolved_at'], ['opened_at', 'resolved_at'], ['effort', 'cutoff']]) {
      const { datasets } = stackWith(from, to) as { datasets: unknown[] };
      expect(DatasetSchema.safeParse(datasets[0]).success, `${from} → ${to}`).toBe(true);
    }
  });

  it('fires through runAuthoringRules on all three commands, gating, and is exported from the barrel', () => {
    expect(BARREL_ID).toBe(RULE);
    const stack = stackWith('due_on', 'resolved_at');
    for (const command of ['validate', 'build', 'lint'] as const) {
      const found = runAuthoringRules(command, { normalized: stack, parsed: stack }).filter((f) => f.rule === RULE);
      expect(found, command).toHaveLength(1);
      expect(found[0].severity, command).toBe('error');
    }
    const accepted = stackWith('opened_at', 'resolved_at');
    expect(runAuthoringRules('lint', { normalized: accepted, parsed: accepted }).filter((f) => f.rule === RULE)).toEqual([]);
  });

  it('a field read only by a duration measure has a consumer', () => {
    const stack = stackWith('opened_at', 'resolved_at');
    const unread = validateFieldConsumers(stack).filter((f) => f.rule === FIELD_NO_CONSUMERS).map((f) => f.message);
    expect(unread.some((m) => /"opened_at"/.test(m)), unread.join('\n')).toBe(false);
    expect(unread.some((m) => /"resolved_at"/.test(m)), unread.join('\n')).toBe(false);
  });

  it('the `fix:` line is one line of at most 200 characters, and `os explain` carries the rest', () => {
    for (const f of findings(stackWith('due_on', 'effort'))) {
      expect(f.hint).not.toContain('\n');
      expect(f.hint.length).toBeLessThanOrEqual(200);
    }
    const text = explainRule(RULE)?.paragraphs.join('\n') ?? '';
    for (const fact of [
      'so both fields must be declared `datetime`',
      'A `date` is a calendar day and a `time` a wall clock',
      'A record missing either instant takes no part in the aggregate',
      '`400 DATASET_INVALID`',
      "`dataset-field-unknown`'s finding",
    ]) {
      expect(text, fact).toContain(fact);
    }
    // The aggregate rule's explanation points the time-between question here.
    expect(explainRule(MEASURE_AGGREGATE_FIELD_TYPE_REFUSED)?.paragraphs.join('\n')).toContain(
      'a `duration: { from, to, unit }` measure (`measure-duration-field-type-refused`)',
    );
  });
});

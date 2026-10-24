// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12780 — every start-node field is gated on exactly the trigger kinds
 * whose engine binding reads it. The enumeration pin.
 *
 * The table below is what `@objectstack/service-automation`'s
 * `AutomationEngine` and the trigger packages read, at objectstack
 * `18.1.0` (the installed `@objectstack/spec` line):
 *
 * - `secret`: the API trigger arms from `config.secret` (`trigger-api`).
 * - `objectName`: lifted into the `record_change` binding, which the
 *   record-change trigger hooks. The `schedule` and `api` bindings never read
 *   it. The `time_relative` binding falls back to it only for the object its
 *   runtime-state row names; the sweep reads `config.timeRelative.object`,
 *   which `TimeRelativeTriggerSchema` requires, so it is not in effect there.
 * - `condition`: the engine evaluates it at the top of every run, for every
 *   trigger kind and for a manual `execute()` of a flow that binds none. No gate.
 * - `schedule.expression`: the schedule trigger and the time-relative sweep's
 *   cadence.
 * - `timeRelative.*`: the time-relative trigger's descriptor.
 * - `triggerType` is the controller, and `criteria` is the legacy key shown
 *   only when stored. Neither is gated on a kind.
 *
 * Each case builds a flow the installed resolver answers as the kind named,
 * and asserts the field is offered empty, or its stored value is kept as "not
 * in effect", exactly as the table says. A start field the table does not name
 * fails the first pin, so a new field cannot land without its row.
 */

import { describe, it, expect } from 'vitest';
import { resolveFlowTriggerKind, type FlowTriggerKind } from '@objectstack/spec/automation';
import { fieldsForNodeType, isFieldVisible, inactiveRetainedKind, type FlowConfigField } from './flow-node-config';

const fields = fieldsForNodeType('start');

type Row = { kinds: readonly FlowTriggerKind[] } | 'every-run' | 'controller' | 'legacy';

const SWEEP_KINDS = ['time_relative'] as const;
const TABLE: Record<string, Row> = {
  triggerType: 'controller',
  secret: { kinds: ['api'] },
  objectName: { kinds: ['record_change'] },
  condition: 'every-run',
  'schedule.expression': { kinds: ['schedule', 'time_relative'] },
  'timeRelative.object': { kinds: SWEEP_KINDS },
  'timeRelative.dateField': { kinds: SWEEP_KINDS },
  'timeRelative.withinDays': { kinds: SWEEP_KINDS },
  'timeRelative.offsetDays': { kinds: SWEEP_KINDS },
  'timeRelative.filter': { kinds: SWEEP_KINDS },
  'timeRelative.maxRecords': { kinds: SWEEP_KINDS },
  criteria: 'legacy',
};

const CRON = { type: 'cron', expression: '0 7 * * *' };
const SWEEP = { object: 'todo_task', dateField: 'due_date', withinDays: 1 };

/** A one-node flow of `type` whose start node carries `config`. */
function flowWith(config: Record<string, unknown>, type = 'autolaunched') {
  return { name: 'f', type, nodes: [{ id: 'start', type: 'start', config }], edges: [] as unknown[] };
}

/**
 * One start shape per answer the resolver gives, canonical and token-spelled,
 * plus the shapes that bind no trigger. `kind` is what the resolver must
 * answer; the first pin below asks it rather than trusting this column.
 */
const SHAPES: Array<{ name: string; kind: FlowTriggerKind | undefined; flow: ReturnType<typeof flowWith> }> = [
  { name: 'record-change token', kind: 'record_change', flow: flowWith({ triggerType: 'record-after-update' }, 'record_change') },
  { name: 'canonical sweep, no token', kind: 'time_relative', flow: flowWith({ timeRelative: SWEEP }, 'schedule') },
  { name: 'sweep under a time_relative token', kind: 'time_relative', flow: flowWith({ triggerType: 'time_relative', timeRelative: SWEEP }, 'schedule') },
  { name: 'canonical schedule, no token', kind: 'schedule', flow: flowWith({ schedule: CRON }, 'schedule') },
  { name: 'schedule under a schedule token', kind: 'schedule', flow: flowWith({ triggerType: 'schedule', schedule: CRON }, 'schedule') },
  { name: 'api flow, no token', kind: 'api', flow: flowWith({}, 'api') },
  { name: 'api token', kind: 'api', flow: flowWith({ triggerType: 'api' }) },
  { name: 'manual token', kind: undefined, flow: flowWith({ triggerType: 'manual' }) },
  { name: 'no trigger at all', kind: undefined, flow: flowWith({}) },
];

/** Whether `row` says the engine reads the field on a flow of `kind`. */
function readsUnder(row: Row, kind: FlowTriggerKind | undefined): boolean | 'skip' {
  if (row === 'every-run') return true;
  if (row === 'controller' || row === 'legacy') return 'skip';
  return kind !== undefined && row.kinds.includes(kind);
}

/** A stored value of the field's kind, so `hasStoredValue` sees it as stored. */
function storedValue(field: FlowConfigField): unknown {
  switch (field.kind) {
    case 'number':
      return 5;
    case 'numberList':
      return [3, 1];
    case 'keyValue':
      return { status: 'open' };
    case 'secret':
      return 's3cret';
    default:
      return 'x_value';
  }
}

/** `node` with `value` written at the field's path. */
function withValue(node: Record<string, unknown>, field: FlowConfigField, value: unknown): Record<string, unknown> {
  const copy = structuredClone(node);
  let cursor = copy as Record<string, unknown>;
  for (const key of field.path.slice(0, -1)) {
    const next = cursor[key];
    cursor[key] = next && typeof next === 'object' ? { ...(next as object) } : {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[field.path[field.path.length - 1]] = value;
  return copy;
}

describe('the start group against the engine binding table (objectui#12780)', () => {
  it('the table names every start field, and no other', () => {
    expect(fields.map((f) => f.id).sort()).toEqual(Object.keys(TABLE).sort());
  });

  it('every shape resolves to the kind it is listed under', () => {
    for (const { name, kind, flow } of SHAPES) expect(resolveFlowTriggerKind(flow), name).toBe(kind);
  });

  it('a kind-gated field carries flowKind equal to its row, and an every-run field carries no gate', () => {
    for (const field of fields) {
      const row = TABLE[field.id];
      if (row === 'every-run') {
        expect(field.flowKind, field.id).toBeUndefined();
        expect(field.showWhen, field.id).toBeUndefined();
      } else if (typeof row === 'object') {
        expect([...(field.flowKind ?? [])].sort(), field.id).toEqual([...row.kinds].sort());
      }
    }
  });

  for (const { name, kind, flow } of SHAPES) {
    describe(name, () => {
      for (const field of fields) {
        const row = TABLE[field.id];
        const reads = readsUnder(row, kind);
        if (reads === 'skip') continue;

        it(`${field.id}: ${reads ? 'offered, and a stored value is in effect' : 'not offered, and a stored value is kept as not in effect'}`, () => {
          const node = flow.nodes[0] as Record<string, unknown>;
          // Empty: offered exactly where the engine reads it.
          expect(isFieldVisible(field, node, fields, kind), 'offered empty').toBe(reads);
          // Stored: always shown, flagged exactly where the engine ignores it.
          const stored = withValue(node, field, storedValue(field));
          expect(isFieldVisible(field, stored, fields, kind), 'stored value shown').toBe(true);
          expect(inactiveRetainedKind(field, stored, fields, kind), 'stored value flag').toBe(reads ? null : 'controller-off');
        });
      }
    });
  }
});

describe("the select tokens that ask for an Object are the record-change tokens (objectui#12780)", () => {
  // The New automation dialog asks for an object on exactly this list, and
  // writes `config.objectName` for it, so a token here that the engine binds
  // without reading the object authors a key that does nothing.
  it('every token in the Object gate resolves to record_change, and every record-change option is in it', () => {
    const objectName = fields.find((f) => f.id === 'objectName')!;
    const trigger = fields.find((f) => f.id === 'triggerType')!;
    const tokens = objectName.showWhen?.equals ?? [];
    for (const token of tokens) {
      expect(resolveFlowTriggerKind(flowWith({ triggerType: token })), String(token)).toBe('record_change');
    }
    const recordOptions = (trigger.options ?? [])
      .map((o) => o.value)
      .filter((v) => resolveFlowTriggerKind(flowWith({ triggerType: v })) === 'record_change');
    expect([...tokens].sort()).toEqual([...recordOptions].sort());
  });
});

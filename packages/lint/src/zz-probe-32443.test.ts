// SCRATCH PROBE for card 32443 — measurement only, never committed.
import { it } from 'vitest';
import { ObjectSchema } from '@objectstack/spec/data';
import { DatasetSchema } from '@objectstack/spec/ui';
import { validateDatasetMeasureAggregates } from './validate-dataset-measure-aggregates.js';
import { validateStackExpressions } from './validate-expressions.js';

const DAYS = 'daysBetween(record.start_date, record.end_date) + 1';
const EMP = ObjectSchema.parse({ name: 'leave_employee', label: 'Employee', fields: { full_name: { type: 'text' }, daily_hours: { type: 'number' } } });
const LEAVE = ObjectSchema.parse({ name: 'leave_request', label: 'Leave request', fields: {
  leave_type: { type: 'select', options: [{ label: 'Annual', value: 'annual' }, { label: 'Sick', value: 'sick' }] },
  start_date: { type: 'date' }, end_date: { type: 'date' },
  employee: { type: 'lookup', reference: 'leave_employee' },
  days: { type: 'number', readonly: true, expression: DAYS },
  days_f: { type: 'formula', returnType: 'number', expression: DAYS },
  hours: { type: 'number', readonly: true, expression: 'record.employee.daily_hours * (daysBetween(record.start_date, record.end_date) + 1)' },
} });
const DS = (field: string) => DatasetSchema.parse({ name: `leave_stats_${field}`, label: 'Leave stats', object: 'leave_request',
  dimensions: [{ name: 'leave_type', field: 'leave_type', type: 'string' }], measures: [{ name: 'total_days', aggregate: 'sum', field }] });

it('probe lint', () => {
  const stack = { objects: [EMP, LEAVE], datasets: [DS('days'), DS('days_f'), DS('hours')] };
  const f = validateDatasetMeasureAggregates(stack);
  console.log('LINT measure findings', JSON.stringify(f, null, 1).slice(0, 3000));
  const e = validateStackExpressions(stack as any);
  console.log('LINT expression issues', JSON.stringify(e.map((x: any) => ({ where: x.where, sev: x.severity, msg: String(x.message).slice(0, 300) })), null, 1));
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `create_record` / `update_record` field value MARKED as text (ruling
 * 6913660232 on objectstack#34062, letter B, parameter 4): the contract half.
 *
 * The text envelope `{ dialect: 'template', source }` is the one spelling, on
 * those two `fields` maps only; a bare string stays a literal value, and every
 * other value slot still refuses a template envelope. Its translation lives at
 * `flows.<flow>.records.<node_id>.fields.<field>`, judged as the text slot it
 * translates.
 */

import { describe, it, expect } from 'vitest';
import {
  AssignmentValueSchema,
  CreateRecordConfigSchema,
  FlowRecordFieldValueSchema,
  FlowValueSlotSchema,
  UpdateRecordConfigSchema,
  VALUE_ENVELOPE_REFUSAL,
} from './builtin-node-config.zod';
import { resolveFlowNodeExpressions } from './flow-node-expression-paths';
import { flowRecordFieldTextKey } from '../system/i18n-resolver';
import { TranslationDataSchema } from '../system/translation.zod';

const TEXT = { dialect: 'template', source: 'Auto-escalated: {{ record.priority }} priority' } as const;

const issuesOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  (result.error?.issues ?? []).map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));

describe('a record field value marked as text — the contract', () => {
  it('both record writes accept a text envelope beside a literal and a CEL envelope, and keep each as written', () => {
    const fields = { escalation_reason: TEXT, status: 'escalated', owner: { dialect: 'cel', source: 'record.owner' } };
    for (const schema of [CreateRecordConfigSchema, UpdateRecordConfigSchema]) {
      const result = schema.safeParse({ objectName: 'crm_case', fields });
      expect(result.success, JSON.stringify(issuesOf(result))).toBe(true);
      expect((result as { data: { fields: unknown } }).data.fields).toEqual(fields);
    }
  });

  it('judges the text as a text slot: a single-brace token and a blank source are refused at the envelope', () => {
    const token = CreateRecordConfigSchema.safeParse({
      objectName: 'crm_case', fields: { reason: { dialect: 'template', source: 'Escalated {record.priority}' } },
    });
    expect(token.success).toBe(false);
    const [refusal] = issuesOf(token);
    expect(refusal?.path).toBe('fields.reason.source');
    expect(refusal?.message.startsWith(VALUE_ENVELOPE_REFUSAL)).toBe(true);
    expect(refusal?.message).toContain('{{ record.priority }}');

    const blank = FlowRecordFieldValueSchema.safeParse({ dialect: 'template', source: '  ' });
    expect(blank.success).toBe(false);
    expect(issuesOf(blank)[0]?.path).toBe('source');
  });

  it('refuses a third dialect by naming the two it takes', () => {
    const cron = FlowRecordFieldValueSchema.safeParse({ dialect: 'cron', source: '0 * * * *' });
    expect(cron.success).toBe(false);
    expect(issuesOf(cron)).toEqual([{ path: 'dialect', message: expect.stringContaining('`template` text envelope') }]);
  });

  it('CONTROL: every other value slot still refuses a template envelope — the text form is the record writes\' alone', () => {
    expect(FlowValueSlotSchema.safeParse(TEXT).success).toBe(false);
    expect(AssignmentValueSchema.safeParse(TEXT).success).toBe(false);
    expect(FlowRecordFieldValueSchema.safeParse(TEXT).success).toBe(true);
  });

  it('a bare string is the literal it spells — never marked, never a text slot', () => {
    expect(FlowRecordFieldValueSchema.parse('escalated')).toBe('escalated');
    // CONTROL: the retired `{…}` token is still refused in a literal.
    expect(FlowRecordFieldValueSchema.safeParse('Hi {record.name}').success).toBe(false);
  });
});

describe('the expression ledger hands the text envelope to the text-slot judge, not the CEL one', () => {
  it('does not emit a record write\'s text envelope as a value expression, and still emits its CEL envelope', () => {
    const config = { objectName: 'crm_case', fields: { reason: TEXT, owner: { dialect: 'cel', source: 'record.owner' } } };
    for (const type of ['create_record', 'update_record']) {
      expect(resolveFlowNodeExpressions(type, config).map((f) => f.path)).toEqual(['fields.owner']);
    }
  });

  it('CONTROL: on a slot that takes no text envelope, a template envelope is emitted — for the CEL judge to refuse', () => {
    const found = resolveFlowNodeExpressions('assignment', { assignments: { note: TEXT } });
    expect(found.map((f) => f.path)).toEqual(['assignments.note']);
  });
});

describe('the translation key a marked field is picked at', () => {
  it('is `flows.<flow>.records.<node_id>.fields.<field>`', () => {
    expect(flowRecordFieldTextKey('case_escalation', 'set_reason', 'escalation_reason'))
      .toBe('flows.case_escalation.records.set_reason.fields.escalation_reason');
  });

  it('the face keeps it, judged as the text slot it translates', () => {
    const ok = TranslationDataSchema.safeParse({
      flows: { case_escalation: { records: { set_reason: { fields: { escalation_reason: '自动升级：{{ record.priority }} 优先级' } } } } },
    });
    expect(ok.success, JSON.stringify(ok.error?.issues)).toBe(true);
    expect((ok as { data: any }).data.flows.case_escalation.records.set_reason.fields.escalation_reason)
      .toBe('自动升级：{{ record.priority }} 优先级');

    const token = TranslationDataSchema.safeParse({
      flows: { case_escalation: { records: { set_reason: { fields: { escalation_reason: '自动升级：{record.priority}' } } } } },
    });
    expect(token.success).toBe(false);
  });
});

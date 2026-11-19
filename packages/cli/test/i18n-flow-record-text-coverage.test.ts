// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#34062 (ruling 6913660232) — a record field value marked as text
// joins the flow bucket.
//
// A `create_record` / `update_record` field value marked `{ dialect:
// 'template', source }` is a sentence the record keeps, written in the
// organization's language. The bundle has a key for it
// (`flows.<flow>.records.<node_id>.fields.<field>`) and the engine reads that
// key before it fills the holes. These pins are the CLI half (parameter 5): the
// walker scaffolds the key, the existing coverage gate demands it, and the key
// the walker writes is the very address the engine asks for
// (`flowRecordFieldTextKey`). A bare string is a literal and has no key.
//
// The ledger mock is `i18n-flow-refusal-coverage.test.ts`'s, for its reason.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@objectstack/lint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@objectstack/lint')>()),
  authorWarnedProperties: () => new Set<string>(),
}));

import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-bundle-extract.js';
import { computeI18nCoverage } from '../src/utils/i18n-coverage.js';
import { TranslationDataSchema, flowRecordFieldTextKey } from '@objectstack/spec/system';

const REASON = 'Auto-escalated: {{ record.priority }} priority';

const caseEscalation = {
  name: 'case_escalation',
  label: 'Case escalation',
  type: 'record_change',
  nodes: [
    { id: 'start', type: 'start', label: 'Start', config: { objectName: 'crm_case', triggerType: 'record-after-update' } },
    {
      id: 'set_reason', type: 'update_record', label: 'Set reason',
      config: {
        objectName: 'crm_case',
        filter: { id: { dialect: 'cel', source: 'record.id' } },
        fields: {
          escalation_reason: { dialect: 'template', source: REASON },
          status: 'escalated',
          owner: { dialect: 'cel', source: 'record.owner' },
        },
      },
    },
    {
      id: 'log', type: 'create_record', label: 'Log',
      config: { objectName: 'crm_case_log', fields: { note: { dialect: 'template', source: 'Escalated.' } } },
    },
    { id: 'done', type: 'end', label: 'Done' },
  ],
  edges: [],
};

const recordEntries = (config: any) =>
  collectExpectedEntries(config).filter((e) => e.path[0] === 'flows' && e.path[2] === 'records');

describe('what the walker harvests from a record write (ruling 6913660232)', () => {
  it('emits one key per field marked as text, keyed as the engine reads it, seeded with the template', () => {
    const entries = recordEntries({ flows: [caseEscalation] });
    expect(entries.map((e) => e.path.join('.'))).toEqual([
      flowRecordFieldTextKey('case_escalation', 'set_reason', 'escalation_reason'),
      flowRecordFieldTextKey('case_escalation', 'log', 'note'),
    ]);
    expect(entries[0]).toMatchObject({ sourceValue: REASON, inline: REASON, source: 'flow' });
    // CONTROL: the bare string and the CEL envelope beside it have no key.
    expect(entries.some((e) => e.path.includes('status') || e.path.includes('owner'))).toBe(false);
  });
});

describe('the coverage gate demands the marked text (ruling 6913660232)', () => {
  const tree = (flows?: Record<string, unknown>) => ({
    i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] },
    flows: [caseEscalation],
    translations: [{ 'zh-CN': { ...(flows ? { flows } : {}) } }],
  });
  const zhRecords = (config: any) =>
    computeI18nCoverage(config).issues.filter(
      (i) => i.locale === 'zh-CN' && i.key.startsWith('flows.') && i.key.includes('.records.'),
    );

  it('reports each untranslated marked field in the flow bucket', () => {
    const issues = zhRecords(tree());
    expect(issues.map((i) => i.key).sort()).toEqual([
      'flows.case_escalation.records.log.fields.note',
      'flows.case_escalation.records.set_reason.fields.escalation_reason',
    ]);
    expect(issues[0]!.source).toBe('flow');
  });

  it('goes quiet once they are translated', () => {
    expect(zhRecords(tree({
      case_escalation: {
        records: {
          set_reason: { fields: { escalation_reason: '自动升级：{{ record.priority }} 优先级' } },
          log: { fields: { note: '已升级。' } },
        },
      },
    }))).toEqual([]);
  });
});

describe('the skeleton `os i18n extract` writes (ruling 6913660232)', () => {
  const result = extractTranslations({ flows: [caseEscalation] }, { locales: ['en', 'zh-CN'] });

  it('writes the template into the default locale and an empty slot into the others', () => {
    expect((result.bundles.en as any).flows.case_escalation.records).toEqual({
      set_reason: { fields: { escalation_reason: REASON } },
      log: { fields: { note: 'Escalated.' } },
    });
    expect((result.bundles['zh-CN'] as any).flows.case_escalation.records).toEqual({
      set_reason: { fields: { escalation_reason: '' } },
      log: { fields: { note: '' } },
    });
  });

  it('parses through the schema it is written for, in every locale', () => {
    for (const [locale, bundle] of Object.entries(result.bundles)) {
      expect(TranslationDataSchema.safeParse(bundle).success, `skeleton for ${locale}`).toBe(true);
    }
  });
});

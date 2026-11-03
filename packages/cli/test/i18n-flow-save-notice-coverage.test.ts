// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#28251 — a `save_notice` node's message joins the flow bucket.
//
// A `save_notice` node hands the person who made the triggering record write a
// sentence about what the save set in motion. The bundle has a key for it
// (`flows.<flow>.notices.<node_id>.message`) and the engine reads that key in
// the writer's locale before it renders the holes. These pins are the CLI half:
// the walker scaffolds the key, the coverage gate demands it, and the key the
// walker writes is the very address the engine asks for (`flowNoticeMessageKey`).
//
// The ledger mock is `i18n-flow-refusal-coverage.test.ts`'s, for its reason.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@objectstack/lint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@objectstack/lint')>()),
  authorWarnedProperties: () => new Set<string>(),
}));

import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract.js';
import { computeI18nCoverage } from '../src/utils/i18n-coverage.js';
import { TranslationDataSchema, flowNoticeMessageKey } from '@objectstack/spec/system';

const NOTICE = 'Sent {{ record.name }} to your manager for approval';

/** HotCRM's measured shape: the notice ahead of the approval that suspends the run. */
const dealSubmit = {
  name: 'deal_submit',
  label: 'Deal submit',
  type: 'record_change',
  nodes: [
    { id: 'start', type: 'start', label: 'Start', config: { objectName: 'deal', triggerType: 'record-after-update' } },
    { id: 'tell', type: 'save_notice', label: 'Tell the saver', config: { message: NOTICE } },
    { id: 'approve', type: 'approval', label: 'Manager approval' },
    { id: 'done', type: 'end', label: 'Done' },
  ],
  edges: [],
};

const noticeEntries = (config: any) =>
  collectExpectedEntries(config).filter((e) => e.path[0] === 'flows' && e.path[2] === 'notices');

describe('what the walker harvests from a save_notice node (#28251)', () => {
  it('emits the message, keyed as the engine reads it, seeded with the template', () => {
    const entries = noticeEntries({ flows: [dealSubmit] });
    expect(entries.map((e) => e.path.join('.'))).toEqual([flowNoticeMessageKey('deal_submit', 'tell')]);
    expect(entries[0]).toMatchObject({ sourceValue: NOTICE, inline: NOTICE, source: 'flow' });
  });

  it('reaches a save_notice nested in an ADR-0031 region', () => {
    const flow = {
      ...dealSubmit,
      nodes: [
        dealSubmit.nodes[0],
        {
          id: 'guard', type: 'try_catch', label: 'Guard',
          config: {
            try: { nodes: [{ id: 'nested_tell', type: 'save_notice', label: 'Tell', config: { message: 'Done.' } }] },
            catch: { nodes: [] },
          },
        },
      ],
    };
    expect(noticeEntries({ flows: [flow] }).map((e) => e.path.join('.'))).toEqual([
      'flows.deal_submit.notices.nested_tell.message',
    ]);
  });
});

describe('the coverage gate demands the notice (#28251)', () => {
  const tree = (flows?: Record<string, unknown>) => ({
    i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] },
    flows: [dealSubmit],
    translations: [{ 'zh-CN': { ...(flows ? { flows } : {}) } }],
  });
  const zhNotices = (config: any) =>
    computeI18nCoverage(config).issues.filter(
      (i) => i.locale === 'zh-CN' && i.key.startsWith('flows.') && i.key.includes('.notices.'),
    );

  it('reports the untranslated notice in the flow bucket', () => {
    const issues = zhNotices(tree());
    expect(issues.map((i) => i.key)).toEqual(['flows.deal_submit.notices.tell.message']);
    expect(issues[0]!.source).toBe('flow');
  });

  it('goes quiet once it is translated', () => {
    expect(zhNotices(tree({ deal_submit: { notices: { tell: { message: '已将 {{ record.name }} 提交给经理审批' } } } })))
      .toEqual([]);
  });
});

describe('the skeleton `os i18n extract` writes (#28251)', () => {
  const result = extractTranslations({ flows: [dealSubmit] }, { locales: ['en', 'zh-CN'] });

  it('writes the template into the default locale and an empty slot into the others', () => {
    expect((result.bundles.en as any).flows.deal_submit.notices).toEqual({ tell: { message: NOTICE } });
    expect((result.bundles['zh-CN'] as any).flows.deal_submit.notices).toEqual({ tell: { message: '' } });
  });

  it('parses through the schema it is written for, in every locale', () => {
    for (const [locale, bundle] of Object.entries(result.bundles)) {
      expect(TranslationDataSchema.safeParse(bundle).success, `skeleton for ${locale}`).toBe(true);
    }
  });
});

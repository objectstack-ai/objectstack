// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `reports.<name>.blocks.<block_name>.…` — a joined report's block copy, and
// the translator that overlays it on the served `report` document.
//
// Before this slot existed, a localized tenant opening a joined report saw a
// translated report title over block headings left in the authoring language:
// the bundle had nowhere to put them, and `.strict()` refused a key a
// translator invented.

import { describe, it, expect } from 'vitest';
import {
  TranslationDataSchema,
  TranslationItemSchema,
  PlatformTranslationDataSchema,
  type TranslationBundle,
} from './translation.zod';
import { translateMetadataDocument, translateReport } from './i18n-resolver';
// Parsed by the authoring schema rather than hand-shaped, so a translator
// reading a member the schema does not carry cannot pass here.
import { ReportSchema } from '../ui/report.zod';

const joined = () => ReportSchema.parse({
  name: 'task_overview',
  label: 'Task Overview',
  type: 'joined',
  blocks: [
    { name: 'open_block', label: 'Open Tasks', description: 'Still in flight', type: 'summary', dataset: 'tasks', rows: ['status'], values: ['n'] },
    { name: 'done_block', label: 'Completed Tasks', type: 'summary', dataset: 'tasks', rows: ['status'], values: ['n'] },
  ],
}) as any;

const bundle: TranslationBundle = {
  'zh-CN': {
    reports: {
      task_overview: {
        label: '任务概览',
        blocks: {
          open_block: { label: '未完成任务', description: '仍在进行中' },
          done_block: { label: '已完成任务' },
        },
      },
    },
  },
};

describe('TranslationDataSchema — reports.<name>.blocks', () => {
  it('accepts the slot at all three doors — bundle entry, platform bundle and registered item', () => {
    expect(TranslationDataSchema.safeParse(bundle['zh-CN']).success).toBe(true);
    expect(PlatformTranslationDataSchema.safeParse(bundle['zh-CN']).success).toBe(true);
    expect(TranslationItemSchema.safeParse({ locale: 'zh-CN', ...bundle['zh-CN'] }).success).toBe(true);
  });

  it('closes a block entry at `label` and `description`', () => {
    const result = TranslationDataSchema.safeParse({
      reports: { task_overview: { blocks: { open_block: { dataset: 'tasks' } } } },
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.code)).toContain('unrecognized_keys');
  });

  it('renames `title` onto `label` inside a block entry', () => {
    const result = TranslationDataSchema.safeParse({
      reports: { task_overview: { blocks: { open_block: { title: '未完成任务' } } } },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues[0];
    expect(issue).toMatchObject({ code: 'unrecognized_keys', keys: ['title'], path: ['reports', 'task_overview', 'blocks', 'open_block'] });
    expect(issue.message).toContain('`title` → `label`');
  });
});

describe('translateReport — joined blocks', () => {
  it('overlays each block heading and caption, keyed by block name', () => {
    const out = translateMetadataDocument('report', joined(), bundle, { locale: 'zh-CN' }) as any;
    expect(out.label).toBe('任务概览');
    expect(out.blocks.map((b: any) => b.label)).toEqual(['未完成任务', '已完成任务']);
    expect(out.blocks[0].description).toBe('仍在进行中');
    // Identity and the selection ride through untouched.
    expect(out.blocks.map((b: any) => b.name)).toEqual(['open_block', 'done_block']);
    expect(out.blocks[0].dataset).toBe('tasks');
    expect(out.blocks[1].description).toBeUndefined();
  });

  it('translates the blocks when the bundle addresses only the blocks', () => {
    const blocksOnly: TranslationBundle = {
      'zh-CN': { reports: { task_overview: { blocks: { done_block: { label: '已完成任务' } } } } },
    };
    const doc = joined();
    const out = translateReport(doc, blocksOnly, { locale: 'zh-CN' }) as any;
    expect(out.label).toBe('Task Overview');
    // An unaddressed block rides through as the same reference.
    expect(out.blocks[0]).toBe(doc.blocks[0]);
    expect(out.blocks[1].label).toBe('已完成任务');
  });

  it('applies the BCP-47 ladder and the fallback chain to blocks', () => {
    expect((translateReport(joined(), bundle, { locale: 'zh' }) as any).blocks[1].label).toBe('已完成任务');
    expect((translateReport(joined(), bundle, { locale: 'fr-FR', fallbackChain: ['zh-CN'] }) as any).blocks[1].label)
      .toBe('已完成任务');
  });

  it('does not mutate the input, and returns the same reference when no block matched', () => {
    const doc = joined();
    const before = JSON.parse(JSON.stringify(doc));
    translateReport(doc, bundle, { locale: 'zh-CN' });
    expect(doc).toEqual(before);
    const other: TranslationBundle = { 'zh-CN': { reports: { task_overview: { blocks: { gone_block: { label: '无' } } } } } };
    expect(translateReport(doc, other, { locale: 'zh-CN' })).toBe(doc);
  });

  describe('the catalog loses to an explicit override (ADR-0029 D9.2a)', () => {
    it('applies while a block still equals its packaged counterpart', () => {
      const out = translateReport(joined(), bundle, { locale: 'zh-CN', packagedBase: joined() }) as any;
      expect(out.blocks[0].label).toBe('未完成任务');
    });

    it('yields to a block heading an org re-authored, and still translates the rest', () => {
      const edited = joined();
      edited.blocks[0] = { ...edited.blocks[0], label: 'Open work (ours)' };
      const out = translateReport(edited, bundle, { locale: 'zh-CN', packagedBase: joined() }) as any;
      expect(out.blocks[0].label).toBe('Open work (ours)');
      expect(out.blocks[0].description).toBe('仍在进行中');
      expect(out.blocks[1].label).toBe('已完成任务');
    });

    it('treats a block the packaged report does not declare as authored after the fact', () => {
      const added = joined();
      added.blocks.push({ name: 'late_block', label: 'Late Tasks', type: 'summary', dataset: 'tasks', values: ['n'] });
      const lateBundle: TranslationBundle = {
        'zh-CN': { reports: { task_overview: { blocks: { late_block: { label: '逾期任务' } } } } },
      };
      expect(translateReport(added, lateBundle, { locale: 'zh-CN', packagedBase: joined() })).toBe(added);
      // No base supplied — nothing is inferred and the catalog applies.
      expect((translateReport(added, lateBundle, { locale: 'zh-CN' }) as any).blocks[2].label).toBe('逾期任务');
    });
  });
});

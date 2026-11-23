/**
 * objectstack#36749 — the Studio's zh pack names an item's `label` with ONE
 * word, 显示名: the add-field input is titled 显示名, so its hints say 显示名
 * too, and the author-facing rows that named `label` 标签 or 显示名称 say 显示名.
 *
 * 标签 keeps its other meanings, which this pin leaves alone: a tab (标签页),
 * the `tags` field type, a branch label on a flow edge, and the label of a
 * page block's own item (a tab, a section, a path stage).
 *
 * Each row is read by key, so a renamed key fails here by name rather than
 * passing with nothing checked.
 */
import { describe, it, expect } from 'vitest';
import STUDIO_ZH from '../namespaces/studio/zh.js';

const zh = STUDIO_ZH as unknown as Record<string, string>;

/** Every row that names an item's `label`, and the word it is pinned to say. */
const LABEL_ROWS = [
  'designer.field.label',
  'engine.studio.data.addFieldNeedsLabel',
  'engine.studio.data.addFieldApiNameNotDerived',
  'perm.field.label',
  'perm.basics.editHint',
  'designer.field.basePatchOnly.optionLabels',
  'engine.inspector.flowNode.sourceLabel',
  'engine.inspector.flowNode.label',
  'engine.create.nameNotDerived',
  'engine.packages.create.name',
  'engine.packages.idRule.derived',
  'engine.packages.idRule.notDerived',
  'engine.datasource.label',
  'engine.studio.if.pageProps.label',
  'engine.studio.auto.newSimilar.label',
  'engine.studio.auto.newSimilar.bodyPair',
  'engine.studio.auto.newSimilar.bodyHere',
  'engine.actionPreview.empty',
  'engine.agentPreview.empty',
  'engine.picklistPreview.colLabel',
  'engine.studio.createItem.notDerived',
  'engine.studio.createItem.needLabel',
  'engine.studio.rules.label',
  'engine.studio.nav.label',
  'engine.list.search',
  'engine.list.col.label',
  'engine.sharingRule.clone.label',
] as const;

describe('the Studio zh pack names `label` 显示名 (objectstack#36749)', () => {
  it('the add-field hints say the word the add-field input is titled with', () => {
    expect(zh['designer.field.label']).toBe('显示名');
    expect(zh['engine.studio.data.addFieldNeedsLabel']).toBe('请先填写显示名。');
    expect(zh['engine.studio.data.addFieldApiNameNotDerived']).toMatch(/^显示名里没有/);
  });

  it.each(LABEL_ROWS)('%s says 显示名, never 标签 or 显示名称', (key) => {
    const row = zh[key];
    expect(typeof row).toBe('string');
    expect(row).toContain('显示名');
    expect(row).not.toContain('显示名称');
    // 标签页 (a tab) is another word and may share the row.
    expect(row.replace(/标签页/gu, '')).not.toContain('标签');
  });
});

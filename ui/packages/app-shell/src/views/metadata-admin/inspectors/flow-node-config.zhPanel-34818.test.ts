// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34818 item 5 — the decision and approval panels read no English
 * in zh-CN: every label, help, option and prose placeholder the inspector
 * draws for them goes through the zh table, and the approval words
 * `quorum` / `per_group` are said in Chinese. Example literals (a CEL
 * expression, a number, a field name) stay as written. en-US is the control:
 * the table is a no-op there.
 */

import { describe, expect, it } from 'vitest';
import { fieldsForNodeType, localizeFlowFields, type FlowConfigField } from './flow-node-config.js';

const CJK = /[㐀-鿿]/;

/** Placeholders that are example literals, not prose: left as written on purpose. */
const LITERAL_PLACEHOLDERS = new Set(['expiring_deals.length > 0', 'amount > 10000', '1', '3', '24', 'approval_status']);

/** Every visible string of a field, with where it sits. */
function strings(field: FlowConfigField): Array<[string, string]> {
  const out: Array<[string, string]> = [[`${field.id}.label`, field.label]];
  if (field.help) out.push([`${field.id}.help`, field.help]);
  if (field.placeholder && !LITERAL_PLACEHOLDERS.has(field.placeholder)) out.push([`${field.id}.placeholder`, field.placeholder]);
  for (const o of field.options ?? []) out.push([`${field.id}.opt.${o.value}`, o.label]);
  for (const c of field.columns ?? []) {
    out.push([`${field.id}.col.${c.key}.label`, c.label]);
    if (c.placeholder && !LITERAL_PLACEHOLDERS.has(c.placeholder)) out.push([`${field.id}.col.${c.key}.placeholder`, c.placeholder]);
    for (const o of c.options ?? []) out.push([`${field.id}.col.${c.key}.opt.${o.value}`, o.label]);
  }
  return out;
}

describe('zh-CN decision and approval panels (objectstack#34818 item 5)', () => {
  it.each(['decision', 'approval'])('every %s string reads Chinese', (type) => {
    const english = strings(fieldsForNodeType(type)[0]!).length; // the table is non-empty
    expect(english).toBeGreaterThan(0);
    const leftEnglish = localizeFlowFields(type, fieldsForNodeType(type), 'zh-CN')
      .flatMap(strings)
      .filter(([, text]) => !CJK.test(text));
    expect(leftEnglish).toEqual([]);
  });

  it('the approval words are said in Chinese, not as `quorum` / `per_group`', () => {
    const all = localizeFlowFields('approval', fieldsForNodeType('approval'), 'zh-CN').flatMap(strings);
    expect(all.filter(([, text]) => /quorum|per_group/.test(text))).toEqual([]);
  });

  it('the approvers help says the node comes with both connections', () => {
    const [approvers] = localizeFlowFields('approval', fieldsForNodeType('approval'), 'zh-CN');
    expect(approvers!.help).toContain('自带「通过」和「驳回」两条连线');
    const [en] = fieldsForNodeType('approval');
    expect(en!.help).toContain('comes with an "approve" and a "reject" connection');
    expect(en!.help).not.toMatch(/Wire the node/);
  });

  it('control: en-US draws the English table unchanged', () => {
    const en = fieldsForNodeType('approval');
    expect(localizeFlowFields('approval', en, 'en-US')).toBe(en);
    const mode = fieldsForNodeType('decision').find((f) => f.id === 'mode')!;
    expect(mode.label).toBe('Branch mode');
  });
});

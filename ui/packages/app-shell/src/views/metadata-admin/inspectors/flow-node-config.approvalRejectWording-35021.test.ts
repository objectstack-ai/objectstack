// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35021 — the approval node's zh panel names the reject decision
 * 驳回, the word of its branch connection, of the runtime inbox and of the
 * approval notifications (ruling 6973602227, option A; premise corrected
 * 6975255638). The `auto_reject` value is stored metadata and stays.
 *
 * Every string the panel draws is enumerated, from the inspector's own field
 * table and from the fields the engine serves (the contract's JSON Schema),
 * and none may say 拒绝. A zh-Hant session draws the same Simplified table
 * (`isZhLocale`), so it is held too. The end node's refused outcome is not an
 * approval decision and keeps 已拒绝 — the control that the replacement did not
 * reach past the approval node.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApprovalNodeConfigSchema } from '@objectstack/spec/automation';
import { fieldsForNodeType, localizeFlowFields, type FlowConfigField } from './flow-node-config.js';
import { jsonSchemaToFlowFields } from './json-schema-to-fields.js';

/** Every visible string of a field, with where it sits. */
function strings(field: FlowConfigField): Array<[string, string]> {
  const out: Array<[string, string]> = [[`${field.id}.label`, field.label]];
  if (field.help) out.push([`${field.id}.help`, field.help]);
  if (field.placeholder) out.push([`${field.id}.placeholder`, field.placeholder]);
  for (const o of field.options ?? []) out.push([`${field.id}.opt.${o.value}`, o.label]);
  for (const c of field.columns ?? []) {
    out.push([`${field.id}.col.${c.key}.label`, c.label]);
    if (c.help) out.push([`${field.id}.col.${c.key}.help`, c.help]);
    for (const o of c.options ?? []) out.push([`${field.id}.col.${c.key}.opt.${o.value}`, o.label]);
  }
  return out;
}

const PANELS = [
  ['the inspector table', () => fieldsForNodeType('approval')],
  ['the served contract', () => jsonSchemaToFlowFields(z.toJSONSchema(ApprovalNodeConfigSchema, { io: 'input' }))!],
] as const;

describe('the approval node panel says 驳回 for the reject decision (objectstack#35021)', () => {
  describe.each(['zh-CN', 'zh-Hant'])('%s', (locale) => {
    it.each(PANELS)('no string of %s says 拒绝', (_name, fields) => {
      const all = localizeFlowFields('approval', fields(), locale).flatMap(strings);
      expect(all.length).toBeGreaterThan(0);
      expect(all.filter(([, text]) => text.includes('拒绝'))).toEqual([]);
    });

    it('the reject-decision strings say 驳回, and the auto_reject value is unchanged', () => {
      const byId = new Map(localizeFlowFields('approval', fieldsForNodeType('approval'), locale).map((f) => [f.id, f]));
      for (const id of ['behavior', 'approvalStatusField', 'escalation.action', 'maxRevisions']) {
        expect(byId.get(id)?.help, id).toContain('驳回');
      }
      const autoReject = byId.get('escalation.action')?.options?.find((o) => o.value === 'auto_reject');
      expect(autoReject?.label).toBe('自动驳回');
    });
  });

  it('control: the end node keeps 已拒绝 for its refused outcome', () => {
    const outcome = localizeFlowFields('end', fieldsForNodeType('end'), 'zh-CN').find((f) => f.id === 'outcome');
    expect(outcome?.options?.find((o) => o.value === 'refused')?.label).toBe('已拒绝');
  });
});

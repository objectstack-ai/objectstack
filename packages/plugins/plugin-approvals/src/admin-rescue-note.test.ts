// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25576] The administrators' routing note: one English source, the reader's
 * language from the same catalog, and a strict read of the stored shape.
 * The end-to-end half (the snapshot an opened request stores, and the door a
 * zh-CN reader reads it through) is `admin-rescue-named-slate.integration.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { adminRescueNoteOf, adminRescueNoteText, adminRescueReason, type ApprovalSentenceRender } from './admin-rescue-note.js';
import { approvalMessages } from './translations/messages.js';

/** A render over one shipped locale of the catalog, `{{hole}}` filled the `t()` way. */
const renderIn = (locale: keyof typeof approvalMessages, drop: string[] = []): ApprovalSentenceRender =>
  (key, params) => {
    const id = key.replace(/^messages\./, '');
    if (drop.includes(id)) return undefined;
    const template = (approvalMessages[locale] as Record<string, string>)[id];
    return template?.replace(/\{\{(\w+)\}\}/g, (hole, name: string) => params[name] ?? hole);
  };

describe('[#25576] the admin_rescue note', () => {
  it('the English is the sentence the row has always stored', () => {
    expect(adminRescueNoteText({ abandoned: ['position:sales_manager', 'team:ops'] })).toBe(
      "Routed to this organization's administrators because the approver slate named no one: "
      + "position 'sales_manager' has no holder; team 'ops' resolved to no one.",
    );
    expect(adminRescueReason([], 'not_declared')).toBe(
      "no approver on the node resolved to a person; onEmptyApprovers is 'fallback' but no fallbackApprovers are declared",
    );
  });

  it('a reader\'s language renders every clause and the separator from its own pack', () => {
    const note = { abandoned: ['position:sales_manager', 'team:ops'], fallback: 'resolved_to_no_one' as const };
    expect(adminRescueNoteText(note, renderIn('zh-CN'))).toBe(
      '审批人名单未指向任何人，因此已转交本组织管理员处理：岗位「sales_manager」无人任职；'
      + 'team「ops」未解析到任何人；声明的 fallbackApprovers 也未解析到任何人。',
    );
    expect(adminRescueNoteText(note, renderIn('ja-JP'))).toContain('役職「sales_manager」に就いている人がいません');
  });

  it('a clause the pack lacks falls back to its English; a missing note sentence renders nothing', () => {
    const note = { abandoned: ['position:sales_manager'] };
    expect(adminRescueNoteText(note, renderIn('zh-CN', ['approvalAdminRescuePositionUnheld']))).toBe(
      "审批人名单未指向任何人，因此已转交本组织管理员处理：position 'sales_manager' has no holder。",
    );
    expect(adminRescueNoteText(note, renderIn('zh-CN', ['approvalAdminRescueNote']))).toBeUndefined();
  });

  it('reads only the shape it writes', () => {
    const good = { action_id: 'aact_1', abandoned: ['position:p'], fallback: 'not_declared' };
    expect(adminRescueNoteOf({ __adminRescueNote: good })).toEqual(good);
    expect(adminRescueNoteOf({ __adminRescueNote: { action_id: 'aact_1', abandoned: [] } }))
      .toEqual({ action_id: 'aact_1', abandoned: [] });
    for (const bad of [
      undefined,
      {},
      { __adminRescueNote: 'Routed to …' },
      { __adminRescueNote: { abandoned: [] } },
      { __adminRescueNote: { action_id: 'aact_1', abandoned: [1] } },
      { __adminRescueNote: { action_id: 'aact_1', abandoned: [], fallback: 'nope' } },
    ]) {
      expect(adminRescueNoteOf(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });
});

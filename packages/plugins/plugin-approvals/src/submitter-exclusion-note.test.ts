// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25573] The submitter exclusion note: one English source, every shipped
 * language from the same catalog, and a strict read of the stored shape. The
 * end-to-end half (the note an opened request writes, and the door a zh-CN
 * reader reads it through) is `exclude-submitter.integration.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { submitterExclusionNoteOf, submitterExclusionNoteText, type SubmitterExclusionRoute } from './submitter-exclusion-note.js';
import { adminRescueNoteOf, adminRescueReason, type ApprovalSentenceRender } from './admin-rescue-note.js';
import { approvalMessages } from './translations/messages.js';

const renderIn = (locale: keyof typeof approvalMessages): ApprovalSentenceRender =>
  (key) => (approvalMessages[locale] as Record<string, string>)[key.replace(/^messages\./, '')];

const ROUTES: SubmitterExclusionRoute[] = ['remaining_approvers', 'fallback', 'administrators', 'no_one'];

describe('[#25573] the submitter exclusion note', () => {
  it('each route has its own English sentence, and every shipped language renders each one', () => {
    const english = ROUTES.map((route) => submitterExclusionNoteText({ route }));
    expect(new Set(english).size).toBe(ROUTES.length);
    for (const text of english) expect(text).toMatch(/^The request's submitter was removed from its approvers/);
    for (const locale of Object.keys(approvalMessages) as Array<keyof typeof approvalMessages>) {
      for (const route of ROUTES) {
        expect(submitterExclusionNoteText({ route }, renderIn(locale)), `${locale} ${route}`).toBeTruthy();
      }
    }
    expect(submitterExclusionNoteText({ route: 'fallback' }, () => undefined)).toBeUndefined();
  });

  it('reads only the shape it writes', () => {
    const good = { action_id: 'aact_1', route: 'administrators' };
    expect(submitterExclusionNoteOf({ __submitterExclusionNote: good })).toEqual(good);
    for (const bad of [
      undefined,
      {},
      { __submitterExclusionNote: 'The request…' },
      { __submitterExclusionNote: { route: 'fallback' } },
      { __submitterExclusionNote: { action_id: 'aact_1', route: 'auto_approve' } },
    ]) {
      expect(submitterExclusionNoteOf(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it("the administrators' note names the exclusion instead of saying no approver resolved to a person", () => {
    expect(adminRescueReason([], undefined, true))
      .toBe("the only approver it resolved to was the request's submitter, whom excludeSubmitter removes");
    expect(adminRescueReason([], undefined)).toBe('no approver on the node resolved to a person');
    expect(adminRescueNoteOf({ __adminRescueNote: { action_id: 'a', abandoned: [], submitter_excluded: true } }))
      .toEqual({ action_id: 'a', abandoned: [], submitter_excluded: true });
    expect(adminRescueNoteOf({ __adminRescueNote: { action_id: 'a', abandoned: [], submitter_excluded: 'yes' } }))
      .toBeUndefined();
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36308] The no-approver note's sentence: the English the row stores and the
 * refusal says, unchanged; each slot's approver type named by its word in the
 * reader's pack; and the submitter's notice, whose holes the messaging service
 * fills per recipient at delivery. The end-to-end half (the timeline a zh-CN
 * reader reads, the notice the submitter is sent, the refusal at the decision
 * door) is `admin-rescue-named-slate.integration.test.ts` and
 * `exclude-submitter.integration.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { noApproverNoteText, noApproverNotice, noApproverWho, submitterRefusalUserMessage } from './no-approver-note.js';
import { interpolate, type ApprovalTextParam } from './approval-notification-text.js';
import type { ApprovalSentenceRender } from './admin-rescue-note.js';
import { approvalMessages, enMessages, NO_APPROVER_NOTICE_MAX_SLOTS } from './translations/messages.js';

type Locale = keyof typeof approvalMessages;

/** A render over one shipped locale of the catalog, `{{hole}}` filled the `t()` way. */
const renderIn = (locale: Locale, drop: string[] = []): ApprovalSentenceRender =>
  (key, params) => {
    const id = key.replace(/^messages\./, '');
    if (drop.includes(id)) return undefined;
    const template = (approvalMessages[locale] as Record<string, string>)[id];
    return template?.replace(/\{\{(\w+)\}\}/g, (hole, name: string) => params[name] ?? hole);
  };

/**
 * A notice's body as the messaging service renders it for a recipient in
 * `locale` (`NotificationTextRenderer`): a keyed param is its key in that
 * locale, a `messages.*` key from the catalog and a `positions.*` key from
 * `pack`, else its fallback; then the body's template is filled.
 */
const deliveredIn = (
  locale: Locale,
  notice: { id: keyof typeof enMessages; params: Record<string, ApprovalTextParam> },
  pack: Record<string, string> = {},
): string => {
  const catalog = approvalMessages[locale] as Record<string, string>;
  const params: Record<string, string> = {};
  for (const [name, param] of Object.entries(notice.params)) {
    if (typeof param === 'string') { params[name] = param; continue; }
    // [#35384] An object-label param is resolved off the object's metadata, which no notice here names.
    if ('object' in param) { params[name] = param.fallback; continue; }
    const looked = param.key.startsWith('messages.') ? catalog[param.key.slice('messages.'.length)] : pack[param.key];
    params[name] = looked ?? param.fallback;
  }
  return interpolate(catalog[notice.id], params);
};

const ENGLISH_LEGAL = 'No one else can approve this request yet. An organization administrator must add a member '
  + "who holds position 'legal'; that member can then decide it.";

describe('[#36308] the no-approver sentence', () => {
  it('the English the row stores and the refusal says is unchanged: the type token and the name', () => {
    expect(noApproverNoteText({ slots: ['position:legal'] })).toBe(ENGLISH_LEGAL);
    expect(noApproverWho(['position:legal', 'team:ops', 'u_1', 'platform_admin:*', 'bu:west']))
      .toBe("position 'legal', team 'ops', bu 'west'");
    expect(noApproverNoteText({})).toBe(enMessages.approvalNoApprover);
  });

  it('a zh-CN reader reads every approver type by its word, and no English type token', () => {
    const slate = ['position:legal', 'team:ops', 'department:west', 'org_membership_level:admin'];
    const zh = noApproverNoteText({ slots: slate }, renderIn('zh-CN'));
    expect(zh).toBe('目前还没有其他人能审批此请求。组织管理员需要添加一名担任'
      + '岗位「legal」、团队「ops」、部门「west」、组织成员级别「admin」的成员，之后由该成员决定。');
    expect(zh).not.toMatch(/position|team|department|org_membership_level/);
    // Every shipped pack names each type in its own word: none but `en` spells the token.
    for (const locale of Object.keys(approvalMessages) as Locale[]) {
      if (locale === 'en') continue;
      const text = noApproverNoteText({ slots: slate }, renderIn(locale));
      expect(text, locale).not.toMatch(/position|team|department|org_membership_level/);
      expect(text, locale).toContain('legal');
    }
  });

  it('a position is named by the label the reader is given, and only a position', () => {
    const label = (name: string) => (name === 'legal' ? '法务' : undefined);
    expect(noApproverNoteText({ slots: ['position:legal', 'position:treasury', 'team:legal'] }, renderIn('zh-CN'), label))
      .toContain('担任岗位「法务」、岗位「treasury」、团队「legal」的成员');
    // The English with a label is what the refusal says: the label inside the English.
    expect(noApproverWho(['position:legal'], label)).toBe("position '法务'");
  });

  it('a type with no word in the catalog is named by its token; a clause the pack lacks falls back to its English', () => {
    expect(noApproverWho(['role:admin'], undefined, renderIn('zh-CN'))).toBe('role「admin」');
    expect(noApproverWho(['position:legal'], undefined, renderIn('zh-CN', ['approvalNoApproverSlot'])))
      .toBe("position 'legal'");
    expect(noApproverWho(['position:legal'], undefined, renderIn('zh-CN', ['approvalApproverTypePosition'])))
      .toBe("position 'legal'");
    expect(noApproverNoteText({ slots: ['position:legal'] }, renderIn('zh-CN', ['approvalNoApproverHolding'])))
      .toBeUndefined();
  });

  it('CONTROL: a note that stored `who` keeps it as written', () => {
    expect(noApproverNoteText({ who: "position 'legal'" }, renderIn('zh-CN')))
      .toBe("目前还没有其他人能审批此请求。组织管理员需要添加一名担任position 'legal'的成员，之后由该成员决定。");
  });
});

describe('[#36308] the submitter\'s notice', () => {
  it('a slate of one slot spells it inline, keyed: the type word and the position\'s pack label', () => {
    const notice = noApproverNotice({ slots: ['position:legal'] }, (name) => (name === 'legal' ? 'Legal Counsel' : undefined));
    expect(notice).toEqual({
      id: 'approvalNoApproverHoldingSlot',
      params: {
        type: { key: 'messages.approvalApproverTypePosition', fallback: 'position' },
        value: { key: 'positions.legal.label', fallback: 'Legal Counsel' },
      },
    });
    // The recipient's pack label first, else the declared label, else the name.
    expect(deliveredIn('zh-CN', notice, { 'positions.legal.label': '法务' })).toBe(
      '目前还没有其他人能审批此请求。组织管理员需要添加一名担任岗位「法务」的成员，之后由该成员决定。',
    );
    expect(deliveredIn('zh-CN', notice)).toContain('担任岗位「Legal Counsel」的成员');
    expect(deliveredIn('zh-CN', noApproverNotice({ slots: ['position:legal'] }))).toContain('担任岗位「legal」的成员');
    expect(deliveredIn('en', noApproverNotice({ slots: ['position:legal'] }))).toBe(ENGLISH_LEGAL);
  });

  it('the inline sentence is, in every pack, the timeline\'s sentence for the same slot', () => {
    for (const slot of ['position:legal', 'team:ops', 'department:west', 'org_membership_level:admin', 'role:admin']) {
      for (const locale of Object.keys(approvalMessages) as Locale[]) {
        expect(deliveredIn(locale, noApproverNotice({ slots: [slot] })), `${locale} ${slot}`)
          .toBe(noApproverNoteText({ slots: [slot] }, renderIn(locale)));
      }
    }
  });

  it('none and a stored `who` as before', () => {
    expect(noApproverNotice({})).toEqual({ id: 'approvalNoApprover', params: {} });
    expect(noApproverNotice({ who: "position 'legal'" }))
      .toEqual({ id: 'approvalNoApproverHolding', params: { who: "position 'legal'" } });
  });
});

describe('[#36463] the submitter\'s notice names several slots in the reader\'s language', () => {
  const declared = (name: string) => (name === 'legal' ? 'Legal Counsel' : undefined);

  it('a slate of two slots spells each inline, keyed, in the slate\'s order', () => {
    const notice = noApproverNotice({ slots: ['position:legal', 'team:ops'] }, declared);
    expect(notice).toEqual({
      id: 'approvalNoApproverHoldingSlots2',
      params: {
        type1: { key: 'messages.approvalApproverTypePosition', fallback: 'position' },
        value1: { key: 'positions.legal.label', fallback: 'Legal Counsel' },
        type2: { key: 'messages.approvalApproverTypeTeam', fallback: 'team' },
        value2: 'ops',
      },
    });
    // The acceptance: a zh-CN submitter reads it entirely in Chinese, the
    // position by its pack label, else as stored (its declared label).
    expect(deliveredIn('zh-CN', notice, { 'positions.legal.label': '法务' })).toBe(
      '目前还没有其他人能审批此请求。组织管理员需要添加一名担任岗位「法务」、团队「ops」的成员，之后由该成员决定。',
    );
    const asStored = deliveredIn('zh-CN', notice);
    expect(asStored).toContain('担任岗位「Legal Counsel」、团队「ops」的成员');
    expect(asStored).not.toMatch(/position|team/);
    // The English a recipient with no pack reads is the sentence the row stores, the declared label inside it.
    expect(deliveredIn('en', notice)).toBe('No one else can approve this request yet. An organization administrator '
      + "must add a member who holds position 'Legal Counsel', team 'ops'; that member can then decide it.");
  });

  it('for every slate size it spells, in every pack, the notice reads the timeline\'s sentence for the same slate', () => {
    const kinds = ['position:legal', 'team:ops', 'department:west', 'org_membership_level:admin', 'role:admin'];
    for (let n = 2; n <= NO_APPROVER_NOTICE_MAX_SLOTS; n++) {
      const slate = Array.from({ length: n }, (_, i) => `${kinds[i % kinds.length]}_${i}`);
      for (const locale of Object.keys(approvalMessages) as Locale[]) {
        expect(deliveredIn(locale, noApproverNotice({ slots: slate })), `${locale} ${n}`)
          .toBe(noApproverNoteText({ slots: slate }, renderIn(locale)));
      }
    }
  });

  it('a slate of more slots than it spells keeps one English `who` inside the reader\'s sentence', () => {
    const slate = Array.from({ length: NO_APPROVER_NOTICE_MAX_SLOTS + 1 }, (_, i) => `team:t${i}`);
    const notice = noApproverNotice({ slots: slate });
    expect(notice.id).toBe('approvalNoApproverHolding');
    expect(notice.params).toEqual({ who: noApproverWho(slate) });
  });
});

describe('[#36463] the decision door\'s refusal of a submitter\'s own approval, as the end user reads it', () => {
  const label = (name: string) => (name === 'legal' ? '法务' : undefined);
  const SLATE = ['position:legal', 'team:ops'];

  it('a zh-CN decider reads each refusal entirely in Chinese, the position by its label', () => {
    const excluded = submitterRefusalUserMessage('excludeSubmitter', SLATE, renderIn('zh-CN'), label);
    expect(excluded).toBe('此请求由您提交，而其审批步骤不允许提交人批准自己的请求，因此您不能批准它。'
      + '目前还没有其他人能审批此请求。组织管理员需要添加一名担任岗位「法务」、团队「ops」的成员，之后由该成员决定。');
    const override = submitterRefusalUserMessage('override', SLATE, renderIn('zh-CN'), label);
    expect(override).toBe('此请求由您提交，且您不在其审批人之列，因此不能以管理员身份代为批准它。'
      + '目前还没有其他人能审批此请求。组织管理员需要添加一名担任岗位「法务」、团队「ops」的成员，之后由该成员决定。'
      + '如需撤销，请驳回或撤回该请求。');
    // No English word but the team's stored value.
    for (const text of [excluded, override]) expect(text.replace('ops', '')).not.toMatch(/[A-Za-z]/);
  });

  it('with another approver on the slate, the remedy names that approver; a slate with no literal names the plain remedy', () => {
    expect(submitterRefusalUserMessage('excludeSubmitter', undefined, renderIn('zh-CN')))
      .toBe('此请求由您提交，而其审批步骤不允许提交人批准自己的请求，因此您不能批准它。'
        + '由该步骤的其他审批人决定；如果只有您持有审批席位，请将其转交给其他人。');
    expect(submitterRefusalUserMessage('override', undefined, renderIn('zh-CN')))
      .toMatch(/^此请求由您提交，且您不在其审批人之列.*由该步骤的审批人决定。/);
    expect(submitterRefusalUserMessage('excludeSubmitter', ['u_sub'], renderIn('zh-CN')))
      .toContain(approvalMessages['zh-CN'].approvalNoApprover);
  });

  it('every shipped pack composes every refusal in its own language, with no hole left', () => {
    for (const locale of Object.keys(approvalMessages) as Locale[]) {
      for (const refusal of ['excludeSubmitter', 'override'] as const) {
        for (const slate of [SLATE, undefined]) {
          const text = submitterRefusalUserMessage(refusal, slate, renderIn(locale), label);
          expect(text, `${locale} ${refusal}`).not.toMatch(/\{\{/);
          if (locale !== 'en') expect(text, `${locale} ${refusal}`).not.toContain('You submitted');
        }
      }
    }
  });

  it('with no reader language, and when the pack lacks a sentence, the whole text is English, never half of each', () => {
    const english = submitterRefusalUserMessage('override', ['position:legal'], undefined, (n) => (n === 'legal' ? 'Legal Counsel' : undefined));
    expect(english).toBe('You submitted this request and hold no slot on it, so you cannot approve it through the '
      + 'administrator override. No one else can approve this request yet. An organization administrator must add a '
      + "member who holds position 'Legal Counsel'; that member can then decide it. To withdraw it instead, reject it or recall it.");
    for (const dropped of ['approvalDecideRefusedOverrideOwnRequest', 'approvalDecideRefusedOverrideWithdraw', 'approvalNoApproverHolding']) {
      expect(submitterRefusalUserMessage('override', ['position:legal'], renderIn('zh-CN', [dropped]), (n) => (n === 'legal' ? 'Legal Counsel' : undefined)), dropped)
        .toBe(english);
    }
  });
});

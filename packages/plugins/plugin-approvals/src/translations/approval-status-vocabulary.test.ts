// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Approval-status vocabulary pin (#7232 — problem 4 of #7213: "three
// vocabularies for one request").
//
// `sys_approval_request` is rendered by three unrelated surfaces — the generic
// object views driven by this plugin's bundles, the Approvals Inbox (objectui
// `approvalsInbox.*`), and the account-app navigation owned by
// `@objectstack/platform-objects`. They share no keys, so nothing made them
// agree, and they did not: zh said 待处理 for the status and 我的待办 for the
// `my_pending` view while the other two said 待审批 / 待我审批, and the en bundle
// shipped the raw enum values (`pending`, `approved`, …) as labels.
//
// What this file pins is the AGREEMENT, not the file contents. Two properties
// it would be easy to assert and worthless to:
//
//   • Re-reading `zhCNObjects.…options.pending` and expecting 待审批 restates
//     the line it is guarding. Every assertion here goes through the real
//     resolver (`translateObject` / `resolveViewLabel`) against the real
//     `SysApprovalRequest`, so the TRANSLATED-locale cases also prove the
//     bundle is REACHED — the declared option label is the authored English
//     from `APPROVAL_STATUS_LABELS` (#8543 promoted it into the contract; see
//     the guard-the-guard case), so a bundle that stopped being consulted
//     would surface in the zh-CN case as English rather than as a silent
//     pass. (Before #8543 the declared label was the bare enum value and the
//     `en` bundle was the only home of the humanized text; now `en` is a
//     verbatim copy of the contract labels, so for `en` alone bundle-reach is
//     indistinguishable from source fallback — by design.)
//
//   • Pinning each locale in isolation lets the layers drift apart again, which
//     is the whole defect. The parity case compares this plugin's `my_pending`
//     view label against the account-app nav label in platform-objects, so
//     moving either side alone goes red.
//
// en is deliberately NOT in the parity set: its nav entry reads "Approvals"
// (the destination) while the view reads "My Pending" (the filter), and #7232's
// glossary keeps that split. Only the locales whose two layers say the same
// thing are pinned to keep saying it.

import { describe, it, expect } from 'vitest';
import { APPROVAL_STATUSES, APPROVAL_STATUS_LABELS } from '@objectstack/spec/contracts';
import { translateObject, resolveViewLabel } from '@objectstack/spec/system';
import type { TranslationData } from '@objectstack/spec/system';
import { zhCN, jaJP, esES } from '@objectstack/platform-objects/apps';

import { ApprovalsTranslations } from './index.js';
import { SysApprovalRequest } from '../sys-approval-request.object.js';

/** Status option labels as a consumer sees them after i18n resolution. */
const resolvedStatusLabels = (locale: string): Record<string, string> => {
  const doc = translateObject(SysApprovalRequest as any, ApprovalsTranslations, { locale });
  const options = (doc as any)?.fields?.status?.options as
    | Array<{ value: string; label?: string }>
    | undefined;
  return Object.fromEntries((options ?? []).map((o) => [o.value, o.label ?? '']));
};

const resolvedMyPendingLabel = (locale: string): string =>
  resolveViewLabel(ApprovalsTranslations, (SysApprovalRequest as any).listViews.my_pending, {
    locale,
  });

const navApprovalsLabel = (data: TranslationData): string | undefined =>
  (data as any)?.apps?.account?.navigation?.nav_account_approvals?.label;

describe('approval status vocabulary (#7232)', () => {
  it('guard the guard: the DECLARED option label is the authored contract label', () => {
    // #8543: the column derives `{ value, label }` from `APPROVAL_STATUSES` +
    // `APPROVAL_STATUS_LABELS`, so the humanized English now lives in the
    // CONTRACT and the `en` bundle is a verbatim copy of it (the extractor's
    // default-locale channel rewrites `en` from the source on every run).
    // This case goes red if someone re-inlines the labels at the column or
    // reverts to the bare-value spread — either would put the English back in
    // a place the regeneration does not read. Bundle-reach for translated
    // locales is proven by the zh-CN case below: the declared label is
    // English, so 待审批 can only come from the bundle.
    const declared = (SysApprovalRequest as any).fields.status.options as Array<{
      value: string;
      label?: string;
    }>;
    expect(declared.length).toBe(APPROVAL_STATUSES.length);
    expect(declared.map((o) => o.value)).toEqual([...APPROVAL_STATUSES]);
    expect(declared.map((o) => o.label)).toEqual(
      APPROVAL_STATUSES.map((s) => APPROVAL_STATUS_LABELS[s]),
    );
  });

  it('en humanizes every status instead of shipping the raw enum value', () => {
    expect(resolvedStatusLabels('en')).toEqual({
      pending: 'Pending',
      approved: 'Approved',
      rejected: 'Rejected',
      recalled: 'Recalled',
      returned: 'Returned',
    });
  });

  it('zh-CN says 待审批 for pending — the Approvals Inbox wording', () => {
    expect(resolvedStatusLabels('zh-CN')).toEqual({
      pending: '待审批',
      approved: '已批准',
      rejected: '已拒绝',
      recalled: '已撤回',
      returned: '已退回修改',
    });
  });

  it('no locale leaks a raw enum value as a status label', () => {
    // Ratchet for statuses and locales added later: a new entry that reaches a
    // bundle un-translated is seeded from the source text, which is the enum
    // value itself, so this case catches it without naming it.
    for (const locale of ['en', 'zh-CN', 'ja-JP', 'es-ES']) {
      const labels = resolvedStatusLabels(locale);
      expect(Object.keys(labels).sort()).toEqual([...APPROVAL_STATUSES].sort());
      const raw = Object.entries(labels)
        .filter(([value, label]) => value === label)
        .map(([value]) => value);
      expect(raw, `${locale} renders these statuses as their raw enum value`).toEqual([]);
    }
  });

  it('the my_pending view carries the per-locale glossary wording', () => {
    expect(resolvedMyPendingLabel('en')).toBe('My Pending');
    expect(resolvedMyPendingLabel('zh-CN')).toBe('待我审批');
    expect(resolvedMyPendingLabel('ja-JP')).toBe('承認待ち');
    expect(resolvedMyPendingLabel('es-ES')).toBe('Aprobaciones pendientes');
  });

  it('the my_pending view label matches the account-app nav label (problem 4)', () => {
    // The cross-layer half: the object view and the navigation entry are owned
    // by different packages and reached by different code paths. This is the
    // assertion that goes red when one of them is reworded alone.
    for (const [locale, nav] of [
      ['zh-CN', zhCN],
      ['ja-JP', jaJP],
      ['es-ES', esES],
    ] as const) {
      const navLabel = navApprovalsLabel(nav);
      expect(navLabel, `platform-objects lost the ${locale} nav_account_approvals label`).toBeTruthy();
      expect(resolvedMyPendingLabel(locale), `${locale} view/nav wording diverged`).toBe(navLabel);
    }
  });
});
